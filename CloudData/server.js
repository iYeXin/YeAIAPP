const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const fs = require('fs').promises;
const path = require('path');
const { VM } = require('vm2');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const app = new Koa();
const router = new Router();
// ==================== 配置 ====================
const PORT = 3546;
const DATA_ROOT = path.join(__dirname, 'data');
const APPS_FILE = path.join(DATA_ROOT, 'apps.json');
const META_FILE = path.join(DATA_ROOT, 'meta.json');
const DEFAULT_MAX_APPS = 100;
const DEFAULT_SIZE_KB = 300;
const VALID_APP_KEY = 'iYeXin@appID';
// 内存状态
let availableAppIds = new Set();
let appMeta = {
    maxApps: DEFAULT_MAX_APPS,
    defaultSizeKB: DEFAULT_SIZE_KB,
    apps: {}
};
const appsData = new Map(); // appId -> { datasets: Map<datasetName, Map<id, record>>, lock: Promise }
// 全局锁
let appsLock = Promise.resolve();
// ==================== 工具函数 ====================
function generateAppId() {
    const randomPart = crypto.randomBytes(8).toString('hex');
    const timestamp = Date.now().toString(36);
    return `${timestamp}-${randomPart}`;
}
async function withAppsLock(fn) {
    return appsLock = appsLock.then(async () => {
        let fileContent;
        try {
            fileContent = await fs.readFile(APPS_FILE, 'utf-8');
        } catch (err) {
            if (err.code === 'ENOENT') {
                fileContent = '[]';
            } else {
                throw err;
            }
        }
        const currentIds = new Set(JSON.parse(fileContent));
        const result = await fn(currentIds);
        await fs.writeFile(APPS_FILE, JSON.stringify(Array.from(currentIds), null, 2));
        availableAppIds = currentIds;
        return result;
    });
}
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}
function pick(obj, keys) {
    const result = {};
    keys.forEach(k => { if (obj.hasOwnProperty(k)) result[k] = obj[k]; });
    return result;
}
// ==================== 初始化 ====================
async function init() {
    await fs.mkdir(DATA_ROOT, { recursive: true });
    try {
        const appsJson = await fs.readFile(APPS_FILE, 'utf-8');
        availableAppIds = new Set(JSON.parse(appsJson));
    } catch (err) {
        if (err.code === 'ENOENT') {
            await fs.writeFile(APPS_FILE, JSON.stringify([]));
            availableAppIds = new Set();
        } else throw err;
    }
    try {
        const metaJson = await fs.readFile(META_FILE, 'utf-8');
        appMeta = JSON.parse(metaJson);
        appMeta.maxApps = appMeta.maxApps || DEFAULT_MAX_APPS;
        appMeta.defaultSizeKB = appMeta.defaultSizeKB || DEFAULT_SIZE_KB;
        appMeta.apps = appMeta.apps || {};
    } catch (err) {
        if (err.code === 'ENOENT') {
            appMeta = {
                maxApps: DEFAULT_MAX_APPS,
                defaultSizeKB: DEFAULT_SIZE_KB,
                apps: {}
            };
            await fs.writeFile(META_FILE, JSON.stringify(appMeta, null, 2));
        } else throw err;
    }
    for (const appId of Object.keys(appMeta.apps)) {
        await loadAppData(appId);
    }
}
async function loadAppData(appId) {
    const appDir = path.join(DATA_ROOT, 'app', appId);
    const dataFile = path.join(appDir, 'data.json');
    try {
        const data = await fs.readFile(dataFile, 'utf-8');
        const rawObject = JSON.parse(data);
        // 转换为内存结构：Map<datasetName, Map<id, record>>
        const datasets = new Map();
        if (rawObject && typeof rawObject === 'object') {
            for (const [dataset, records] of Object.entries(rawObject)) {
                if (Array.isArray(records)) {
                    const recordsMap = new Map(records.map(rec => [rec.id, rec]));
                    datasets.set(dataset, recordsMap);
                }
            }
        }
        appsData.set(appId, { datasets, lock: Promise.resolve() });
    } catch (err) {
        if (err.code === 'ENOENT') {
            await fs.mkdir(appDir, { recursive: true });
            await fs.writeFile(dataFile, JSON.stringify({})); // 初始化为空对象
            appsData.set(appId, { datasets: new Map(), lock: Promise.resolve() });
        } else throw err;
    }
}
// ==================== 中间件 ====================
// 跨域头
app.use(async (ctx, next) => {
    ctx.set('Access-Control-Allow-Origin', '*');
    ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    ctx.set('Access-Control-Allow-Headers', 'X-App-ID, X-Key, Content-Type');
    if (ctx.method === 'OPTIONS') {
        ctx.status = 204;
        return;
    }
    await next();
});
// 解析 appID
router.use(async (ctx, next) => {
    if (ctx.path === '/apply-app') {
        await next();
        return;
    }
    const appId = ctx.get('X-App-ID');
    if (!appId) {
        ctx.status = 400;
        ctx.body = { error: 'Missing X-App-ID header' };
        return;
    }
    const appDir = path.join(DATA_ROOT, 'app', appId);
    let dirExists = false;
    try {
        await fs.access(appDir);
        dirExists = true;
    } catch (err) { }
    if (!dirExists) {
        if (!availableAppIds.has(appId)) {
            ctx.status = 403;
            ctx.body = { code: 1, error: 'App ID not in available list' };
            return;
        }
        if (Object.keys(appMeta.apps).length >= appMeta.maxApps) {
            ctx.status = 403;
            ctx.body = { code: 2, error: 'Maximum number of apps reached' };
            return;
        }
        await fs.mkdir(appDir, { recursive: true });
        await fs.writeFile(path.join(appDir, 'data.json'), JSON.stringify({})); // 初始化空对象
        appMeta.apps[appId] = { sizeLimitKB: appMeta.defaultSizeKB };
        await fs.writeFile(META_FILE, JSON.stringify(appMeta, null, 2));
        appsData.set(appId, { datasets: new Map(), lock: Promise.resolve() });
    } else {
        if (!appsData.has(appId)) {
            await loadAppData(appId);
        }
    }
    ctx.state.appId = appId;
    ctx.state.appData = appsData.get(appId);
    ctx.state.sizeLimitKB = appMeta.apps[appId]?.sizeLimitKB || appMeta.defaultSizeKB;
    await next();
});
// ==================== 写锁工具 ====================
// 修改：接收 dataset 参数，操作特定数据集
async function withWriteLock(appId, dataset, fn) {
    const entry = appsData.get(appId);
    if (!entry) throw new Error('App not loaded');
    return entry.lock = entry.lock.then(async () => {
        // 获取或创建该数据集的 Map
        let dsMap = entry.datasets.get(dataset);
        if (!dsMap) {
            dsMap = new Map();
            entry.datasets.set(dataset, dsMap);
        }
        const newDsMap = await fn(dsMap);
        // 如果返回 false，表示操作中断（如冲突检查失败），不写入
        if (newDsMap !== false) {
            entry.datasets.set(dataset, newDsMap);
            // 重组数据用于写入：将 Map 结构还原为 JSON 对象
            const outputObject = {};
            for (const [dsName, recordsMap] of entry.datasets) {
                outputObject[dsName] = Array.from(recordsMap.values());
            }
            const dataFile = path.join(DATA_ROOT, 'app', appId, 'data.json');
            const dataStr = JSON.stringify(outputObject, null, 2);
            const sizeKB = Buffer.byteLength(dataStr, 'utf-8') / 1024;
            const limitKB = appMeta.apps[appId]?.sizeLimitKB || appMeta.defaultSizeKB;
            if (sizeKB > limitKB) {
                throw { code: 3, message: 'Data size limit exceeded' };
            }
            await fs.writeFile(dataFile, dataStr);
        }
    });
}
// ==================== API 实现 ====================
router.post('/apply-app', async ctx => {
    const key = ctx.get('X-Key');
    if (key !== VALID_APP_KEY) {
        ctx.status = 401;
        ctx.body = { error: 'Invalid or missing X-Key' };
        return;
    }
    try {
        const newAppId = await withAppsLock(async (currentIds) => {
            let newId;
            do {
                newId = generateAppId();
            } while (currentIds.has(newId));
            currentIds.add(newId);
            return newId;
        });
        ctx.status = 200;
        ctx.body = { appId: newAppId };
    } catch (err) {
        console.error('Failed to create appId:', err.stack);
        ctx.status = 500;
        ctx.body = { error: 'Internal server error' };
    }
});
// 添加记录
router.post('/data/:dataset', async ctx => {
    const { dataset } = ctx.params;
    const record = ctx.request.body;
    const id = generateId();
    const now = new Date().toISOString();
    const newRecord = { id, ...record, _createdAt: now, _updatedAt: now };
    const appId = ctx.state.appId;
    await withWriteLock(appId, dataset, (dsRecords) => {
        if (dsRecords.has(id)) { // 理论上 generateId 不会重复，这里保留防御性代码
            ctx.status = 409;
            ctx.body = { error: 'Record id conflict' };
            return false;
        }
        const newMap = new Map(dsRecords);
        newMap.set(id, newRecord);
        ctx.status = 201;
        ctx.body = newRecord;
        return newMap;
    });
});
// 获取单条记录
router.get('/data/:dataset/:id', async ctx => {
    const { dataset, id } = ctx.params;
    const fields = ctx.query.fields ? ctx.query.fields.split(',') : null;
    const datasets = ctx.state.appData.datasets;
    const dsMap = datasets.get(dataset);
    const record = dsMap ? dsMap.get(id) : null;
    if (!record) {
        ctx.status = 404;
        ctx.body = { error: 'Record not found' };
        return;
    }
    ctx.body = fields ? pick(record, fields) : record;
});
// 更新记录
router.put('/data/:dataset/:id', async ctx => {
    const { dataset, id } = ctx.params;
    const updates = ctx.request.body;
    const appId = ctx.state.appId;
    await withWriteLock(appId, dataset, (dsRecords) => {
        if (!dsRecords.has(id)) {
            ctx.status = 404;
            ctx.body = { error: 'Record not found' };
            return false;
        }
        const oldRecord = dsRecords.get(id);
        const newRecord = {
            ...oldRecord,
            ...updates,
            id,
            _updatedAt: new Date().toISOString(),
        };
        const newMap = new Map(dsRecords);
        newMap.set(id, newRecord);
        ctx.body = newRecord;
        return newMap;
    });
});
// 删除记录
router.delete('/data/:dataset/:id', async ctx => {
    const { dataset, id } = ctx.params;
    const appId = ctx.state.appId;
    await withWriteLock(appId, dataset, (dsRecords) => {
        if (!dsRecords.has(id)) {
            ctx.status = 404;
            ctx.body = { error: 'Record not found' };
            return false;
        }
        const newMap = new Map(dsRecords);
        newMap.delete(id);
        ctx.status = 204;
        return newMap;
    });
});
// 批量获取
router.post('/data/:dataset/batch', async ctx => {
    const { dataset } = ctx.params;
    const { ids, fields } = ctx.request.body;
    if (!Array.isArray(ids)) {
        ctx.status = 400;
        ctx.body = { error: 'ids must be an array' };
        return;
    }
    const datasets = ctx.state.appData.datasets;
    const dsMap = datasets.get(dataset) || new Map();
    const items = ids
        .map(id => dsMap.get(id))
        .filter(r => r)
        .map(r => fields ? pick(r, fields) : r);
    ctx.body = { items };
});
// 查询
router.post('/data/:dataset/query', async ctx => {
    const { dataset } = ctx.params;
    const { filter, fields, sort, limit, offset } = ctx.request.body;
    const datasets = ctx.state.appData.datasets;
    const dsMap = datasets.get(dataset);
    let records = dsMap ? Array.from(dsMap.values()) : [];
    if (filter) {
        const vm = new VM({
            timeout: 500,
            sandbox: {
                records: records,
                $now: Date.now(),
                $date: (iso) => new Date(iso).getTime(),
            }
        });
        const script = `records.filter(record => { return (${filter}); });`;
        try {
            records = vm.run(script);
        } catch (e) {
            console.error(`Filter error for app ${ctx.state.appId}:`, e.stack);
            ctx.status = 400;
            ctx.body = { error: 'Invalid filter expression' };
            return;
        }
    }
    if (sort) {
        const keys = Object.keys(sort);
        records.sort((a, b) => {
            for (const key of keys) {
                const order = sort[key];
                if (a[key] < b[key]) return order === 1 ? -1 : 1;
                if (a[key] > b[key]) return order === 1 ? 1 : -1;
            }
            return 0;
        });
    }
    const total = records.length;
    if (typeof offset === 'number') records = records.slice(offset);
    if (typeof limit === 'number') records = records.slice(0, limit);
    if (fields) {
        records = records.map(r => pick(r, fields));
    }
    ctx.body = { items: records, total };
});
// ==================== Socket.IO 整合 ====================
const server = http.createServer(app.callback());
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});
const appRooms = new Map();
io.use((socket, next) => {
    const appId = socket.handshake.auth.appId || socket.handshake.headers['x-app-id'];
    if (!appId) {
        return next(new Error('Authentication error: Missing App ID'));
    }
    if (!availableAppIds.has(appId) && !appMeta.apps[appId]) {
        return next(new Error('Authentication error: Invalid App ID'));
    }
    socket.appId = appId;
    if (!appRooms.has(appId)) {
        appRooms.set(appId, {
            rooms: new Set(),
            timers: new Map()
        });
    }
    next();
});
io.on('connection', (socket) => {
    console.log(`Client connected to app: ${socket.appId}, socket: ${socket.id}`);
    const appId = socket.appId;
    const appState = appRooms.get(appId);
    socket.on('joinRoom', (roomName) => {
        if (!roomName || typeof roomName !== 'string') {
            socket.emit('error', { message: 'Invalid room name' });
            return;
        }
        if (appState.timers.has(roomName)) {
            clearTimeout(appState.timers.get(roomName));
            appState.timers.delete(roomName);
        }
        socket.join(roomName);
        appState.rooms.add(roomName);
        console.log(`Client ${socket.id} joined room: ${roomName} in app: ${appId}`);
        socket.emit('joinedRoom', {
            roomName,
            message: `Successfully joined room: ${roomName}`
        });
        socket.to(roomName).emit('userJoined', {
            socketId: socket.id,
            roomName
        });
    });
    socket.on('sendMessage', (data) => {
        const { roomName, message } = data;
        if (!roomName || !message) {
            socket.emit('error', { message: 'Room name and message are required' });
            return;
        }
        const rooms = Array.from(socket.rooms);
        if (!rooms.includes(roomName)) {
            socket.emit('error', { message: 'You are not in this room' });
            return;
        }
        io.to(roomName).emit('roomMessage', {
            roomName,
            message,
            senderId: socket.id,
            timestamp: new Date().toISOString()
        });
    });
    socket.on('leaveRoom', (roomName) => {
        handleLeaveRoom(socket, roomName, appId, appState);
    });
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id} from app: ${appId}`);
        const rooms = Array.from(socket.rooms);
        rooms.forEach(roomName => {
            if (roomName !== socket.id) {
                handleLeaveRoom(socket, roomName, appId, appState);
            }
        });
    });
});
function handleLeaveRoom(socket, roomName, appId, appState) {
    socket.leave(roomName);
    console.log(`Client ${socket.id} left room: ${roomName} in app: ${appId}`);
    socket.to(roomName).emit('userLeft', {
        socketId: socket.id,
        roomName
    });
    const roomSockets = io.sockets.adapter.rooms.get(roomName);
    if (!roomSockets || roomSockets.size === 0) {
        const timer = setTimeout(() => {
            const currentRoomSockets = io.sockets.adapter.rooms.get(roomName);
            if (!currentRoomSockets || currentRoomSockets.size === 0) {
                appState.rooms.delete(roomName);
                appState.timers.delete(roomName);
                console.log(`Room ${roomName} deleted from app ${appId} (no clients)`);
            }
        }, 5 * 60 * 1000);
        appState.timers.set(roomName, timer);
    }
}
// ==================== 错误处理中间件 ====================
app.use(async (ctx, next) => {
    try {
        await next();
    } catch (err) {
        console.error('Unhandled error:', err.stack);
        ctx.status = 500;
        ctx.body = { error: 'Internal server error' };
    }
});
app.use(bodyParser());
app.use(router.routes());
app.use(router.allowedMethods());
// 启动服务器
init().then(() => {
    server.listen(PORT, '127.0.0.1', () => {
        console.log(`Server running on http://127.0.0.1:${PORT}`);
        console.log(`Socket.IO server running on ws://127.0.0.1:${PORT}`);
    });
}).catch(err => {
    console.error('Init failed:', err.stack);
    process.exit(1);
});