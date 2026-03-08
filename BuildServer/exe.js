const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const url = require('url');

// ==================== 配置常量 ====================
const HOST = '127.0.0.1';
const PORT = 8001;
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

// 确保下载目录存在
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// 内存存储：token -> { filePath, expiresAt, size }
const downloads = new Map();

// ==================== 过期文件清理 ====================
function cleanupExpiredDownloads() {
    const now = Date.now();
    for (const [token, record] of downloads.entries()) {
        if (record.expiresAt <= now) {
            try {
                if (fs.existsSync(record.filePath)) {
                    fs.unlinkSync(record.filePath);
                    console.log(`已删除过期文件: ${record.filePath}`);
                }
            } catch (err) {
                console.error(`清理过期文件失败: ${record.filePath}`, err);
            }
            downloads.delete(token);
        }
    }
}
// 每分钟执行一次清理
setInterval(cleanupExpiredDownloads, 60 * 1000);

// ==================== NivaAppBuilder 类 ====================
class NivaAppBuilder {
    constructor() {
        this.nivaDevToolsPath = "C:\\Users\\Administrator\\Desktop\\NivaDevtools.exe";
    }

    async buildApplicationFromJSON(jsonData) {
        try {
            const { src, config, description, icon, couldDataConfig } = jsonData;

            if (!src || !Array.isArray(src)) {
                throw new Error('缺少src字段或src不是数组');
            }
            if (!config || typeof config !== 'object') {
                throw new Error('缺少config字段或config不是对象');
            }

            const projectDir = await this.createTempProject(src, config, icon, couldDataConfig);

            try {
                // 构建应用，返回 token 和文件大小
                const { token, size } = await this.buildApplication(projectDir, config.name);

                // 生成下载 URL
                const downloadUrl = `/download/${token}`;

                // 清理临时项目目录
                await this.cleanupTempDirectory(projectDir);

                return {
                    success: true,
                    download_url: downloadUrl,
                    expires_in: 24 * 60 * 60, // 24小时
                    description: description || '生成的桌面应用',
                    size: size,
                    timestamp: new Date().toISOString()
                };
            } catch (error) {
                // await this.cleanupTempDirectory(projectDir);                
                console.error(error)
                throw error;
            }

        } catch (error) {
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async createTempProject(src, config, icon_data, couldDataConfig) {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'niva-app-'));

        try {
            // 1. 创建 niva.json 配置文件
            const nivaConfigPath = path.join(tempDir, 'niva.json');
            fs.writeFileSync(nivaConfigPath, JSON.stringify(config, null, 2));

            // 2. 准备 js 目录（用于存放库文件和 clouddata.js）
            const jsDir = path.join(tempDir, 'js');
            fs.mkdirSync(jsDir, { recursive: true });

            // 3. 复制 lib 库文件到 js/lib
            const originLibDir = path.join(__dirname, 'lib');
            const targetLibDir = path.join(jsDir, 'lib');
            if (fs.existsSync(originLibDir)) {
                await fs.promises.cp(originLibDir, targetLibDir, { recursive: true });
                console.log('lib 库文件已复制到:', targetLibDir);
            } else {
                console.warn('警告: lib 目录不存在，跳过库文件复制');
            }

            // 4. 处理 clouddata.js，替换占位符
            const clouddataSrcPath = path.join(__dirname, 'clouddata.js');
            if (!fs.existsSync(clouddataSrcPath)) {
                throw new Error('clouddata.js 文件不存在');
            }
            let clouddataContent = fs.readFileSync(clouddataSrcPath, 'utf8');
            if (couldDataConfig && couldDataConfig.baseURL && couldDataConfig.appID) {
                // 替换占位符 /* System filling */
                const replacement = `const baseURL = "${couldDataConfig.baseURL}";\nconst appID = "${couldDataConfig.appID}";`;
                clouddataContent = clouddataContent.replace('/* System filling */', replacement);
                console.log('已替换 clouddata.js 中的占位符');
            } else {
                console.warn('警告: couldDataConfig 缺失或字段不全，clouddata.js 将保持原样');
            }
            const clouddataTargetPath = path.join(jsDir, 'clouddata.js');
            fs.writeFileSync(clouddataTargetPath, clouddataContent);
            console.log('clouddata.js 已写入:', clouddataTargetPath);

            // 5. 创建 assets 目录
            const assetsDir = path.join(tempDir, 'assets');
            fs.mkdirSync(assetsDir, { recursive: true });

            // 6. 处理图标
            await this.handleIcon(assetsDir, icon_data);

            // 7. 创建源代码文件
            for (const file of src) {
                const filePath = path.join(tempDir, file.path);
                const dirName = path.dirname(filePath);
                fs.mkdirSync(dirName, { recursive: true });
                fs.writeFileSync(filePath, file.content);
            }

            console.log(`项目已创建在: ${tempDir}`);
            return tempDir;

        } catch (error) {
            await this.cleanupTempDirectory(tempDir);
            throw new Error(`创建临时项目失败: ${error.message}`);
        }
    }

    async handleIcon(assetsDir, icon_data) {
        const iconPath = path.join(assetsDir, 'icon.png');

        try {
            if (icon_data) {
                let base64Data = icon_data;
                if (icon_data.startsWith('data:')) {
                    base64Data = icon_data.split(',')[1];
                }
                const iconBuffer = Buffer.from(base64Data, 'base64');
                fs.writeFileSync(iconPath, iconBuffer);
                console.log('使用提供的base64图标');
            } else {
                const defaultIcon = this.createDefaultIcon();
                fs.writeFileSync(iconPath, defaultIcon);
                console.log('使用默认图标');
            }
        } catch (error) {
            console.warn('处理图标失败:', error.message);
            const defaultIcon = this.createDefaultIcon();
            fs.writeFileSync(iconPath, defaultIcon);
        }
    }

    createDefaultIcon() {
        const base64Icon = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFXSURBVDiNpZM9SwNBEIafgwQLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG1sLG/0x5GFZdnYB+crszs7szDvzzgqllPqPJgFIKf8sUEoJIYRS6v0vAiGEUkp9fHwo0zSVaZoqkUioZrOplFJqMBioWq2mAEzTVK1WSw2HQ6WUUoZhKMMwlGEYqt/vK6WU6vV6qtvtKsMw1HA4VLZtq1KppLLZrEomkyqXy6lKpaJcLhcA3G63SqfTKpPJqEwmo9LptHK5XMrpdKpYLKaazaZqt9uq0Wioer2u6vW6ajQaqtVqqXa7rRzFYlFdXl6qy8tLVSwW1cXFhTo/P1dnZ2fq9PRUnZycqOPjY3V0dKQODw/VwcGB2t/fV3t7e2p3d1ft7Oyo7e1ttbW1pTY3N9XGxoZaX19Xa2tr6vj4WL2+vqqXlxf1/Pysnp6e1OPjo3p4eFD39/fq7u5O3d7eqpsb/9+7uzt1e3urbm5u1PX1tbq6ulKXl5fq4uJCnZ+fq7OzM3V6eqpOTk7U8fGxOjo6UoeHh+rg4EDt7++rvb09tbu7q3Z2dtT29rba2tpSm5ubamNjQ62vr6u1tTW1urqqVlZW1PLyslpaWlKLi4tqYWFBlUolNT8/r+bm5tTs7KyamZlR09PTampqSk1OTqqJiQk1Pj6uxsbG1OjoqBoZGVHDw8NqaGhIDQ4OqoGBAdXf36/6+vpUb2+v6unpUd3d3aqrq0t1dnaqjo4O1d7ertra2lRra6tqaWlRzc3NqqmpSTU2NqqGhgZVX1+v6urqVG1traqpqVHV1dWqqqpKVVZWqoqKClVeXq7KyspUaWmpKikpUcXFxaqoqEgVFhaqgoIClZ+fr/Ly8lRubq7KyclR2dnZKisrS2VmZqqMjAyVnp6u0tLSVGpqqkpJSVHJyckqKSlJJSYmquPHj6uEhAQVHx+v4uLiVGxsrIqJiVHR0dEqKipKRUZGqoiICBUeHq7CwsJUaGioCgkJUTExMQrALwCGmhntU3UoGwAAAABJRU5ErkJggg==';
        return Buffer.from(base64Icon, 'base64');
    }

    async buildApplication(projectDir, appName) {
        return new Promise((resolve, reject) => {
            const outputPath = path.join(os.tmpdir(), `niva-app-${Date.now()}.exe`);

            const server = http.createServer(async (req, res) => {
                if (req.method === 'POST') {
                    let body = '';
                    req.on('data', chunk => body += chunk);
                    req.on('end', async () => {
                        try {
                            const result = JSON.parse(body);
                            res.writeHead(200, {
                                'Content-Type': 'application/json',
                                'Access-Control-Allow-Origin': '*',
                                'Access-Control-Allow-Methods': 'POST',
                                'Access-Control-Allow-Headers': 'Content-Type'
                            });
                            res.end(JSON.stringify({ status: 'ok' }));

                            if (result.success) {
                                console.log('构建成功，开始处理输出文件...');
                                try {
                                    // 读取生成的 exe 文件
                                    const exeBuffer = fs.readFileSync(outputPath);
                                    // 生成唯一 token
                                    const token = crypto.randomBytes(16).toString('hex');
                                    const destPath = path.join(DOWNLOAD_DIR, `${appName}-${Math.random().toString(36).substr(2, 9)}.exe`);
                                    // 复制文件到下载目录
                                    fs.copyFileSync(outputPath, destPath);
                                    // 删除临时 exe 文件
                                    fs.unlinkSync(outputPath);
                                    const size = exeBuffer.length;
                                    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h有效期

                                    downloads.set(token, { filePath: destPath, expiresAt, size });

                                    server.close();
                                    resolve({ token, size });
                                } catch (error) {
                                    server.close();
                                    reject(new Error(`处理输出文件失败: ${error.message}`));
                                }
                            } else {
                                server.close();
                                reject(new Error(`构建失败: ${result.message || '未知错误'}`));
                            }
                        } catch (error) {
                            res.writeHead(500, {
                                'Content-Type': 'application/json',
                                'Access-Control-Allow-Origin': '*'
                            });
                            res.end(JSON.stringify({ status: 'error', message: error.message }));
                            server.close();
                            reject(new Error(`回调处理失败: ${error.message}`));
                        }
                    });
                } else {
                    res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
                    res.end();
                }
            });

            server.listen(0, '127.0.0.1', async () => {
                const port = server.address().port;
                const callbackUrl = `http://127.0.0.1:${port}`;

                try {
                    if (!fs.existsSync(this.nivaDevToolsPath)) {
                        server.close();
                        reject(new Error(`Niva开发工具不存在: ${this.nivaDevToolsPath}`));
                        return;
                    }

                    const command = `"${this.nivaDevToolsPath}" --action=build --project="${projectDir}" --output="${outputPath}" --callback="${callbackUrl}"`;
                    console.log(`执行命令: ${command}`);

                    exec(command, (error, stdout, stderr) => {
                        if (error) console.error(`命令执行错误: ${error}`);
                        if (stdout) console.log(`stdout: ${stdout}`);
                        if (stderr) console.error(`stderr: ${stderr}`);
                    });

                    // 设置超时（60秒）
                    setTimeout(() => {
                        if (server.listening) {
                            server.close();
                            reject(new Error('构建超时，未收到回调'));
                        }
                    }, 60000);

                } catch (error) {
                    server.close();
                    reject(new Error(`启动构建命令失败: ${error.message}`));
                }
            });

            server.on('error', (error) => {
                reject(new Error(`回调服务器错误: ${error.message}`));
            });
        });
    }

    async cleanupTempDirectory(dirPath) {
        try {
            if (fs.existsSync(dirPath)) {
                fs.rmSync(dirPath, { recursive: true, force: true });
                console.log(`已清理临时目录: ${dirPath}`);
            }
        } catch (error) {
            console.warn(`清理临时目录失败: ${error.message}`);
        }
    }
}

// ==================== 主 HTTP 服务器 ====================
const appBuilder = new NivaAppBuilder();

const server = http.createServer(async (req, res) => {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // 处理 GET 请求（下载端点）
    if (req.method === 'GET') {
        const parsedUrl = url.parse(req.url, true);
        if (parsedUrl.pathname.startsWith('/download/')) {
            const token = parsedUrl.pathname.substring('/download/'.length);
            if (!token) {
                res.writeHead(400);
                res.end('Missing token');
                return;
            }

            const record = downloads.get(token);
            if (!record) {
                // 修改点：返回美观的 HTML 页面
                const message = '请求的资源不存在或已过期，请尝试重新构建';
                let html = '';
                try {
                    // 读取模板文件（假设与当前脚本同目录）
                    const templatePath = path.join(__dirname, 'return.template.html');
                    html = fs.readFileSync(templatePath, 'utf-8');
                    // 替换占位符 {{message}} 为实际消息
                    html = html.replace('{{message}}', message);
                } catch (err) {
                    console.error('读取模板文件失败', err);
                    // 降级：返回简单 HTML 字符串
                    html = `<!DOCTYPE html>
                <html>
                <head><meta charset="UTF-8"><meta http-equiv="refresh" content="3;url=javascript:history.back()"><title>资源不存在</title></head>
                <body style="font-family:sans-serif; text-align:center; padding-top:2rem;"><p>${message}</p><p style="color:#666;">3秒后将自动返回上一页</p></body>
                </html>`;
                }
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
                return;
            }

            if (record.expiresAt <= Date.now()) {
                // 过期处理（保持不变）
                try {
                    if (fs.existsSync(record.filePath)) {
                        fs.unlinkSync(record.filePath);
                    }
                } catch (err) {
                    console.error('删除过期文件失败', err);
                }
                downloads.delete(token);
                res.writeHead(410);
                res.end('Download expired');
                return;
            }

            if (!fs.existsSync(record.filePath)) {
                downloads.delete(token);
                res.writeHead(404);
                res.end('File not found');
                return;
            }

            // 发送文件（保持不变）
            const fileName = path.basename(record.filePath);
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Content-Length': record.size,
            });
            const fileStream = fs.createReadStream(record.filePath);
            fileStream.pipe(res);
            fileStream.on('error', (err) => {
                console.error('文件流错误', err);
                res.end();
            });
            return;
        } else {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
    }

    // 只处理 POST 请求
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '只支持 POST 请求' }));
        return;
    }

    // 检查路径
    if (req.url !== '/yexinyexin/') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '路径不存在' }));
        return;
    }

    try {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });

        req.on('end', async () => {
            try {
                console.log('收到请求，开始处理...');
                const jsonData = JSON.parse(body);
                const result = await appBuilder.buildApplicationFromJSON(jsonData);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
                console.log('请求处理完成:', result.success ? '成功' : '失败');
            } catch (error) {
                console.error('处理请求时出错:', error);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: `请求数据格式错误: ${error.message}` }));
            }
        });
    } catch (error) {
        console.error('服务器错误:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: `服务器内部错误: ${error.message}` }));
    }
});

// 启动服务器
server.listen(PORT, HOST, () => {
    console.log(`Niva应用构建服务器运行在 http://${HOST}:${PORT}`);
    console.log(`接收路径: /yexinyexin/`);
    console.log(`下载路径: /download/:token (有效期10分钟)`);
    console.log(`Niva工具路径: ${appBuilder.nivaDevToolsPath}`);
    console.log(`下载目录: ${DOWNLOAD_DIR}`);
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('正在关闭服务器...');
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});

server.on('error', (error) => {
    console.error('服务器错误:', error);
});

module.exports = { NivaAppBuilder, server };