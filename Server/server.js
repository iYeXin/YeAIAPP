// server.js
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-body').default;
const session = require('koa-session').default;
const static = require('koa-static');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const EventEmitter = require('events');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const tar = require('tar');
const { Mutex } = require('async-mutex');

const renderTaskResultMail = require('./mail-templates/taskResult');

// 引入示意流程中的模块（假设放在 /modules 下）
const buildRequirementClarificationPrompt = require('./modules/prompt1');
const buildPrompt = require('./modules/prompt2');
const { models, cloudData, buildServer } = require('./modules/config');
const createAICaller = require('./modules/createAICaller');
const getCloudDataInfo = require('./modules/getCloudDataInfo');
const buildApp = require('./modules/buildApp');

const PORT = process.env.PORT || 1029;

// 新增：定义任务最终状态
const FINAL_STATES = ['completed', 'failed', 'awaiting_build'];

// 初始化 Koa 及中间件
const app = new Koa();
const router = new Router();
app.keys = ['some-secret-key-change-in-production']; // session 密钥
app.use(session(app));
app.use(bodyParser({ multipart: true, formidable: { keepExtensions: true } }));
app.use(static(path.join(__dirname, 'public'))); // 前端静态文件

// 全局事件发射器，用于 SSE 进度推送
const taskEvents = new EventEmitter();

// 数据目录配置
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const KEYS_FILE = path.join(DATA_DIR, 'keys.json');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// 确保数据目录存在
async function ensureDataDirectories() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
    // 同时确保临时目录存在（原有逻辑依赖 temp）
    await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
}

let data = { users: {}, tasks: {} };
let keys = []; // [{ key, remaining }]

// 文件读写锁
const dataMutex = new Mutex();
const keysMutex = new Mutex();

// 加载或初始化数据文件
async function loadData() {
    await ensureDataDirectories();
    try {
        const content = await fs.readFile(DATA_FILE, 'utf-8');
        data = JSON.parse(content);
    } catch (err) {
        data = { users: {}, tasks: {} };
        await saveData();
    }
}
async function saveData() {
    await dataMutex.runExclusive(async () => {
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    });
}
async function loadKeys() {
    await ensureDataDirectories();
    try {
        const content = await fs.readFile(KEYS_FILE, 'utf-8');
        keys = JSON.parse(content);
    } catch (err) {
        keys = [];
        await saveKeys();
    }
}
async function saveKeys() {
    await keysMutex.runExclusive(async () => {
        await fs.writeFile(KEYS_FILE, JSON.stringify(keys, null, 2));
    });
}

// 构建服务状态（缓存，每分钟可刷新）
let buildServiceAvailable = false;
async function checkBuildService() {
    const url = `${buildServer.buildServerURL.replace(/\/+$/, '')}/test`;
    try {
        const response = await fetch(url, { method: 'GET' });
        if (response.status === 404) {
            const text = await response.text();
            buildServiceAvailable = text === 'Not found';
        } else {
            buildServiceAvailable = false;
        }
    } catch (err) {
        buildServiceAvailable = false;
    }
}
// 启动时检查一次
checkBuildService();
// 每分钟检查一次
setInterval(checkBuildService, 60000);

// 邮件发送配置
const transporter = nodemailer.createTransport({
    host: '',
    port: 465,
    secure: true,
    auth: { user: '', pass: '' }
});
// 临时存储验证码（内存 + 过期）
const verificationCodes = new Map();

// Turnstile 密钥（从环境变量读取或直接配置）
const TURNSTILE_SECRET = ''; // 后端密钥

// 工具函数：生成随机验证码
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// 工具函数：创建临时目录存放源码
async function writeSourceFiles(taskId, appJson, iconBuffer) {
    const taskDir = path.join(__dirname, 'temp', taskId);
    await fs.mkdir(taskDir, { recursive: true });
    // 写入源码文件
    for (const file of appJson.src) {
        const filePath = path.join(taskDir, file.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content, 'utf-8');
    }
    // 写入图标
    await fs.writeFile(path.join(taskDir, 'icon.png'), iconBuffer);
    // 写入 niva.json
    await fs.writeFile(path.join(taskDir, 'niva.json'), JSON.stringify(appJson.config, null, 2));
    return taskDir;
}

// 工具函数：打包源码为 tar.gz
async function createSourceArchive(taskId) {
    const task = data.tasks[taskId];
    if (!task || !task.srcDir) throw new Error('Task or source not found');
    const archivePath = path.join(__dirname, 'temp', `${taskId}.tar.gz`);
    await tar.c({ gzip: true, file: archivePath, cwd: task.srcDir }, ['.']);
    return archivePath;
}

// 工具函数：清理需求中的自动添加部分
function cleanRequirement(raw) {
    if (!raw) return '';
    const idx = raw.indexOf('===用户建议===');
    return idx !== -1 ? raw.substring(0, idx).trim() : raw;
}

// 修改后的 sendTaskResultEmail 函数
async function sendTaskResultEmail(taskId) {
    const task = data.tasks[taskId];
    if (!task) return;
    if (!task.sendEmail) return; // 如果不需要发送，直接返回

    const userEmail = task.userId;

    // 准备模板变量
    const completionTime = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const isSuccess = task.status === 'completed';
    const failureReason = task.error || task.message || '未知错误';
    const cleanReq = cleanRequirement(task.requirement);

    // 构建任务详情链接
    let taskDetailUrl = '';
    if (task.frontendBaseUrl) {
        taskDetailUrl = `${task.frontendBaseUrl}/tasks/${taskId}`;
    }

    // 生成HTML
    const html = renderTaskResultMail({
        isSuccess,
        requirement: cleanReq,
        completionTime,
        taskDetailUrl,
        fileURL: task.buildResult?.fileURL || '',
        expiresIn: task.buildResult?.expiresIn ? (task.buildResult.expiresIn / 3600).toFixed(0) : '',
        size: task.buildResult?.size ? (task.buildResult.size / 1024 / 1024).toFixed(2) : '',
        failureReason
    });

    try {
        await transporter.sendMail({
            from: '"YeXin - 应用生成" <noreply@yexin.wiki>',
            to: userEmail,
            subject: `应用生成任务${isSuccess ? '完成' : '失败'}通知`,
            html
        });
        console.log(`任务结果邮件已发送至 ${userEmail} 任务 ${taskId}`);
    } catch (err) {
        console.error(`发送任务结果邮件失败 ${taskId}:`, err);
    }
}
// ==================== 新增结束 ====================

// 任务处理主流程（异步执行）
async function processTask(taskId, requirement, iconBuffer) {
    const updateTask = async (updates) => {
        await dataMutex.runExclusive(() => {
            if (data.tasks[taskId]) {
                Object.assign(data.tasks[taskId], updates);
            }
        });
        await saveData();
        taskEvents.emit(taskId, { ...updates, additionalInfo: { messageForUser: data.tasks[taskId].messageForUser || null } }); // 推送进度

        // 新增：如果更新中包含状态且为最终状态，且任务要求邮件通知，则发送邮件（异步）
        if (updates.status && FINAL_STATES.includes(updates.status)) {
            const task = data.tasks[taskId];
            if (task && task.sendEmail) {
                // 异步发送，不阻塞
                sendTaskResultEmail(taskId).catch(console.error);
            }
        }
    };

    try {
        await updateTask({ status: 'clarifying', progress: 0.1, message: '开始需求澄清（预计需要 1 分钟）' });

        const prompt1 = buildRequirementClarificationPrompt();
        const aiCaller1 = createAICaller(models.clarificator);
        const clarification = JSON.parse(await aiCaller1(prompt1, requirement));
        if (!clarification.accept) {
            await updateTask({
                status: 'failed',
                progress: 0,
                message: '需求未通过',
                messageForUser: clarification.explanationForUser
            });
            return;
        }
        await updateTask({
            clarifiedRequirement: clarification.clarifiedRequirement,
            messageForUser: clarification.explanationForUser,
            progress: 0.3
        });

        await updateTask({ status: 'generating', progress: 0.5, message: `正在生成代码（预计需要 ${Math.floor(5 + Math.random() * 5)} 分钟）` });
        const prompt2 = buildPrompt();
        const aiCaller2 = createAICaller(models.coder);
        let appJson;
        try {
            appJson = JSON.parse(await aiCaller2(prompt2, clarification.clarifiedRequirement));
        } catch {
            await updateTask({ progress: 0, message: '代码生成未成功，试试简化需求', status: 'failed' });
            return;
        }

        await updateTask({ progress: 0.7, message: '代码生成完成，正在写入文件' });
        const srcDir = await writeSourceFiles(taskId, appJson, iconBuffer);

        // 将 AI 生成的完整 JSON 保存到独立文件（不存入 data.json）
        const projectFilePath = path.join(PROJECTS_DIR, `${taskId}.json`);
        await fs.writeFile(projectFilePath, JSON.stringify(appJson, null, 2));

        await updateTask({
            status: 'generated',
            progress: 0.8,
            message: '源码已准备',
            projectFilePath,  // 只存储文件路径，不存实际内容
            srcDir
        });

        // 检查构建服务是否可用
        if (buildServiceAvailable) {
            await updateTask({ status: 'building', progress: 0.9, message: '开始构建应用（预计需要 15 秒）' });
            await performBuild(taskId);
        } else {
            await updateTask({
                status: 'awaiting_build',
                progress: 0.85,
                message: '构建服务不可用，请稍后手动触发构建'
            });
        }
    } catch (err) {
        console.error(err);
        await updateTask({ status: 'failed', progress: 0, message: '处理异常', error: err.message });
    }
}

// 执行构建（可被手动触发调用）
async function performBuild(taskId) {
    const task = data.tasks[taskId];
    if (!task) return;
    await dataMutex.runExclusive(() => {
        task.status = 'building';
        task.progress = 0.9;
        task.message = '正在构建应用';
    });
    await saveData();
    taskEvents.emit(taskId, { status: 'building', progress: 0.9, message: '正在构建应用' });

    try {
        // 从独立文件读取 AI 生成的完整 JSON
        const appJson = JSON.parse(await fs.readFile(task.projectFilePath, 'utf-8'));
        const cloudDataConfig = await getCloudDataInfo(cloudData);
        const iconBuffer = await fs.readFile(path.join(task.srcDir, 'icon.png'));
        const buildResult = await buildApp(appJson, buildServer, iconBuffer, cloudDataConfig);
        await dataMutex.runExclusive(() => {
            task.buildResult = buildResult;
            task.updatedAt = new Date().toISOString();
            if (buildResult.success) {
                task.status = 'completed';
                task.progress = 1.0;
                task.message = '构建成功';
            } else {
                task.status = 'failed';
                task.message = '构建失败';
            }
        });
        await saveData();
        taskEvents.emit(taskId, { status: task.status, progress: task.progress, message: task.message, buildResult });
        await sendTaskResultEmail(taskId)

        // 注意：这里不用再单独触发邮件，因为 updateTask 已经包含了状态变更，会触发邮件
    } catch (err) {
        console.error(err);
        await dataMutex.runExclusive(() => {
            task.status = 'failed';
            task.message = '构建异常';
            task.error = err.message;
        });
        await saveData();
        taskEvents.emit(taskId, { status: 'failed', message: '构建异常' });
    }
}

// ---------- 路由定义 ----------

// 1. 发送验证码（新增人机验证）
router.post('/api/auth/send-code', async (ctx) => {
    const { email, turnstileToken } = ctx.request.body;
    if (!email || !turnstileToken) {
        ctx.status = 400;
        ctx.body = { error: '邮箱和人机验证令牌为必填' };
        return;
    }

    // 验证 Turnstile token
    try {
        const formData = new URLSearchParams();
        formData.append('secret', TURNSTILE_SECRET);
        formData.append('response', turnstileToken);

        const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: formData
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
            console.warn('Turnstile 验证失败:', verifyData);
            ctx.status = 400;
            ctx.body = { error: '人机验证失败，请重试' };
            return;
        }
    } catch (err) {
        console.error('调用 Turnstile 验证接口出错:', err);
        ctx.status = 500;
        ctx.body = { error: '人机验证服务异常' };
        return;
    }

    const code = generateCode();
    verificationCodes.set(email, { code, expires: Date.now() + 5 * 60 * 1000 }); // 5分钟有效
    // 发送邮件
    try {
        const templatePath = path.join(__dirname, 'code.template.html');
        let htmlTemplate = await fs.readFile(templatePath, 'utf-8');
        htmlTemplate = htmlTemplate.replace(/{{code}}/g, code);

        await transporter.sendMail({
            from: '"YeXin - 应用生成" <noreply@yexin.wiki>',
            to: email,
            subject: '您的验证码',
            html: htmlTemplate,
            text: `验证码：${code}，5分钟内有效。`
        });
        ctx.body = { success: true };
    } catch (err) {
        console.error(err);
        ctx.status = 500;
        ctx.body = { error: '邮件发送失败' };
    }
});

// 2. 验证码登录
router.post('/api/auth/verify', async (ctx) => {
    const { email, code } = ctx.request.body;
    const record = verificationCodes.get(email);
    if (!record || record.code !== code || record.expires < Date.now()) {
        ctx.status = 400;
        ctx.body = { error: '验证码错误或已过期' };
        return;
    }
    // 登录成功，建立 session
    ctx.session.user = email;
    // 确保用户在 data.users 中存在
    await dataMutex.runExclusive(() => {
        if (!data.users[email]) {
            data.users[email] = { email, tasks: [] };
        }
    });
    await saveData();
    verificationCodes.delete(email);
    ctx.body = { success: true, email };
});

// 3. 获取当前用户
router.get('/api/user/me', async (ctx) => {
    if (!ctx.session.user) {
        ctx.status = 401;
        ctx.body = { error: '未登录' };
        return;
    }
    ctx.body = { email: ctx.session.user };
});

// 4. 退出登录（新增）
router.post('/api/auth/logout', async (ctx) => {
    ctx.session = null; // 销毁 session
    ctx.body = { success: true };
});

// 5. 创建任务（需要登录和有效密钥）—— 新增 sendEmail 和 frontendBaseUrl 处理
router.post('/api/tasks', async (ctx) => {
    if (!ctx.session.user) {
        ctx.status = 401;
        ctx.body = { error: '请先登录' };
        return;
    }
    const { requirement, apiKey, sendEmail } = ctx.request.body; // 新增 sendEmail
    const iconFile = ctx.request.files?.icon;
    if (!requirement || !apiKey || !iconFile) {
        ctx.status = 400;
        ctx.body = { error: '需求、密钥和图标为必填' };
        return;
    }

    // 处理 sendEmail 布尔值（可能为字符串 'true'/'false'）
    const sendEmailBool = sendEmail === true || sendEmail === 'true';

    // 从 Referer 获取前端基础 URL
    let frontendBaseUrl = '';
    const referer = ctx.headers.referer;
    if (referer) {
        try {
            const url = new URL(referer);
            frontendBaseUrl = url.origin; // 协议+主机名+端口
        } catch (e) {
            // 忽略无效 referer
        }
    }

    // 验证密钥并扣除次数
    let keyEntry;
    await keysMutex.runExclusive(() => {
        keyEntry = keys.find(k => k.key === apiKey);
        if (keyEntry && keyEntry.remaining > 0) {
            keyEntry.remaining -= 1;
        }
    });
    if (!keyEntry || keyEntry.remaining < 0) {
        ctx.status = 403;
        ctx.body = { error: '无效密钥或次数已用完' };
        return;
    }
    await saveKeys();

    // 读取图标（已由前端裁剪为 1024x1024）
    const iconBuffer = await fs.readFile(iconFile.filepath);

    // 生成任务 ID
    const taskId = uuidv4();
    const now = new Date().toISOString();
    const task = {
        id: taskId,
        userId: ctx.session.user,
        status: 'pending',
        progress: 0,
        message: '任务已创建',
        requirement,
        createdAt: now,
        updatedAt: now,
        sendEmail: sendEmailBool,      // 新增
        frontendBaseUrl                // 新增
    };

    await dataMutex.runExclusive(() => {
        data.tasks[taskId] = task;
        data.users[ctx.session.user].tasks.push(taskId);
    });
    await saveData();

    // 异步处理任务
    processTask(taskId, requirement, iconBuffer).catch(console.error);

    ctx.body = { taskId, status: 'pending' };
});

// 6. 获取任务详情（单个）
router.get('/api/tasks/:id', async (ctx) => {
    if (!ctx.session.user) {
        ctx.status = 401;
        ctx.body = { error: '未登录' };
        return;
    }
    const task = data.tasks[ctx.params.id];
    if (!task || task.userId !== ctx.session.user) {
        ctx.status = 404;
        ctx.body = { error: '任务不存在或无权限' };
        return;
    }
    ctx.body = task;
});

// 7. 获取当前用户的所有任务
router.get('/api/tasks', async (ctx) => {
    if (!ctx.session.user) {
        ctx.status = 401;
        ctx.body = { error: '未登录' };
        return;
    }
    const user = data.users[ctx.session.user];
    if (!user) {
        ctx.status = 404;
        ctx.body = { error: '用户不存在' };
        return;
    }
    // 从 data.tasks 中提取用户的任务，按创建时间倒序排列
    const tasks = user.tasks
        .map(id => data.tasks[id])
        .filter(task => task) // 过滤可能不存在的任务
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // 返回给前端时，只保留必要字段，避免泄露内部路径等敏感信息
    ctx.body = tasks.map(task => ({
        id: task.id,
        requirement: task.requirement,
        status: task.status,
        progress: task.progress,
        message: task.message,
        additionalInfo: { messageForUser: task.messageForUser || null, },
        createdAt: task.createdAt,
        buildResult: task.buildResult ? {
            success: task.buildResult.success,
            fileURL: task.buildResult.fileURL,
            size: task.buildResult.size,
            expiresIn: task.buildResult.expiresIn
        } : undefined
    }));
});

// 8. SSE 进度推送
router.get('/api/tasks/:id/progress', async (ctx) => {
    if (!ctx.session.user) {
        ctx.status = 401;
        return;
    }
    const taskId = ctx.params.id;
    const task = data.tasks[taskId];
    if (!task || task.userId !== ctx.session.user) {
        ctx.status = 404;
        return;
    }

    ctx.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    ctx.status = 200;

    const sendEvent = (data) => {
        ctx.res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 立即发送当前状态
    sendEvent({ status: task.status, progress: task.progress, message: task.message, additionalInfo: { messageForUser: task.messageForUser || null } });

    // 监听任务事件
    const listener = (updates) => {
        sendEvent(updates);
    };
    taskEvents.on(taskId, listener);

    // 心跳：每30秒发送一个注释行，防止连接超时
    const heartbeat = setInterval(() => {
        ctx.res.write(': heartbeat\n\n');
    }, 30000);

    // 清理
    ctx.req.on('close', () => {
        clearInterval(heartbeat);
        taskEvents.off(taskId, listener);
    });
});

// 9. 手动触发构建
router.post('/api/tasks/:id/build', async (ctx) => {
    if (!ctx.session.user) {
        ctx.status = 401;
        ctx.body = { error: '未登录' };
        return;
    }
    const taskId = ctx.params.id;
    const task = data.tasks[taskId];
    if (!task || task.userId !== ctx.session.user) {
        ctx.status = 404;
        ctx.body = { error: '任务不存在' };
        return;
    }
    if (!['generated', 'awaiting_build', 'failed'].includes(task.status) && Date.now() - new Date(task.updatedAt) < task.buildResult.expiresIn * 1000) {
        ctx.status = 400;
        ctx.body = { error: '当前状态不可手动构建' };
        return;
    }
    if (!buildServiceAvailable) {
        ctx.status = 400;
        ctx.body = { error: '构建服务当前不可用' };
        return;
    }
    // 异步执行构建
    performBuild(taskId).catch(console.error);
    ctx.body = { success: true, message: '构建已触发' };
});

// 10. 下载源码包
router.get('/api/tasks/:id/download/source', async (ctx) => {
    if (!ctx.session.user) {
        ctx.status = 401;
        ctx.body = { error: '未登录' };
        return;
    }
    const taskId = ctx.params.id;
    const task = data.tasks[taskId];
    if (!task || task.userId !== ctx.session.user) {
        ctx.status = 404;
        ctx.body = { error: '任务不存在' };
        return;
    }
    if (!task.srcDir) {
        ctx.status = 400;
        ctx.body = { error: '源码尚未准备好' };
        return;
    }
    try {
        const archivePath = await createSourceArchive(taskId);
        ctx.attachment(`${taskId}.tar.gz`);
        ctx.set('Content-Type', 'application/gzip');
        ctx.body = fsSync.createReadStream(archivePath);
    } catch (err) {
        ctx.status = 500;
        ctx.body = { error: '打包失败' };
    }
});

// 11. 获取可执行文件下载链接
router.get('/api/tasks/:id/download/executable', async (ctx) => {
    if (!ctx.session.user) {
        ctx.status = 401;
        ctx.body = { error: '未登录' };
        return;
    }
    const taskId = ctx.params.id;
    const task = data.tasks[taskId];
    if (!task || task.userId !== ctx.session.user) {
        ctx.status = 404;
        ctx.body = { error: '任务不存在' };
        return;
    }
    if (!task.buildResult?.success) {
        ctx.status = 400;
        ctx.body = { error: '构建尚未成功' };
        return;
    }
    ctx.body = { fileURL: task.buildResult.fileURL };
});

// 12. 查询构建服务状态
router.get('/api/build-service/status', async (ctx) => {
    ctx.body = { available: buildServiceAvailable };
});

// 挂载路由
app.use(router.routes()).use(router.allowedMethods());

// 启动服务器
app.listen(PORT, async () => {
    await ensureDataDirectories();
    await loadData();
    await loadKeys();
    console.log(`Server running on http://localhost:${PORT}`);
});