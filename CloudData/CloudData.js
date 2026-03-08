/* System filling */

/**
 * CloudData SDK - 内置 user 插件的简易云端数据存储客户端
 * 
 * 依赖全局变量 baseURL 和 appID（由系统填充）
 * 插件功能纯前端模拟，不考虑安全性，适合试验项目。
 * 
 * 内部字段 __ownerID__ 对外展示为 userID，数据集前缀 __user__ 完全隐藏。
 */
class CloudData {
    constructor() {
        this.baseURL = baseURL;
        this.appID = appID;
        this._plugins = {};
    }

    async request(endpoint, options = {}) {
        const url = this.baseURL.replace(/\/+$/, '') + '/' + endpoint.replace(/^\/+/, '');
        const headers = {
            'Content-Type': 'application/json',
            'X-App-ID': this.appID,
            ...options.headers,
        };

        const response = await fetch(url, {
            ...options,
            headers,
        });


        if (!response.ok) {
            let errorData;
            try { errorData = await response.json(); } catch (e) { errorData = { error: response.statusText }; }
            const error = new Error(errorData.error || `HTTP ${response.status}`);
            error.status = response.status;
            error.code = errorData.code;
            throw error;
        }

        if (response.status === 204) return null;
        return await response.json();
    }

    use(pluginName) {
        if (!this._plugins[pluginName]) {
            if (pluginName === 'user') {
                this._plugins[pluginName] = new UserPlugin(this);
            } else if (pluginName === 'socket') {
                this._plugins[pluginName] = new SocketPlugin(this);
            } else {
                throw new Error(`Unknown plugin: ${pluginName}`);
            }
        }
        return this._plugins[pluginName];
    }

    // ---------- 核心数据操作 ----------
    async add(dataset, record) {
        return this.request(`data/${dataset}`, { method: 'POST', body: JSON.stringify(record) });
    }

    async get(dataset, id, fields = null) {
        let endpoint = `data/${dataset}/${id}`;
        if (fields) endpoint += `?fields=${encodeURIComponent(Array.isArray(fields) ? fields.join(',') : fields)}`;
        return this.request(endpoint);
    }

    async update(dataset, id, record) {
        return this.request(`data/${dataset}/${id}`, { method: 'PUT', body: JSON.stringify(record) });
    }

    async delete(dataset, id) {
        return this.request(`data/${dataset}/${id}`, { method: 'DELETE' });
    }

    async batchGet(dataset, ids, fields = null) {
        const body = { ids };
        if (fields) body.fields = fields;
        const result = await this.request(`data/${dataset}/batch`, { method: 'POST', body: JSON.stringify(body) });
        return result.items;
    }

    async query(dataset, options = {}) {
        const body = {};
        if (options.filter !== undefined) body.filter = options.filter;
        if (options.fields !== undefined) body.fields = options.fields;
        if (options.sort !== undefined) body.sort = options.sort;
        if (options.limit !== undefined) body.limit = options.limit;
        if (options.offset !== undefined) body.offset = options.offset;
        return this.request(`data/${dataset}/query`, { method: 'POST', body: JSON.stringify(body) });
    }
}

// ---------- User 插件 (保持逻辑，优化结构) ----------
class UserPlugin {
    constructor(client) {
        this.client = client;
        this.currentUser = null;
        this._loadSession();
    }

    _saveSession() {
        if (this.currentUser) localStorage.setItem('clouddata_user_session', JSON.stringify(this.currentUser));
        else localStorage.removeItem('clouddata_user_session');
    }

    _loadSession() {
        const saved = localStorage.getItem('clouddata_user_session');
        if (saved) try { this.currentUser = JSON.parse(saved); } catch (e) { this.currentUser = null; }
    }

    _clearSession() {
        this.currentUser = null;
        localStorage.removeItem('clouddata_user_session');
    }

    async initAnonymous(options = {}) {
        if (!this.currentUser || options.overwrite) {
            this._clearSession();
            this.currentUser = {
                id: 'anon_' + Math.random().toString(36).substring(2, 10),
                isAnonymous: true,
                token: 'anon_token_' + Math.random().toString(36).substring(2),
            };
            this._saveSession();
        }
        return this.currentUser;
    }

    async register({ username, password }) {
        const usersDataset = '__users__';
        const existing = await this.client.query(usersDataset, { filter: `record.username === '${username}'` });
        if (existing.items.length > 0) throw new Error('Username already exists');

        const created = await this.client.add(usersDataset, { username, password, createdAt: new Date().toISOString() });
        this.currentUser = { id: created.id, username, isAnonymous: false, token: 'token_' + Math.random().toString(36).substring(2) };
        this._saveSession();
        return this.currentUser;
    }

    async login({ username, password }) {
        const result = await this.client.query('__users__', {
            filter: `record.username === '${username}' && record.password === '${password}'`
        });
        if (result.items.length === 0) throw new Error('Invalid username or password');
        const userRecord = result.items[0];
        this.currentUser = { id: userRecord.id, username: userRecord.username, isAnonymous: false, token: 'token_' + Math.random().toString(36).substring(2) };
        this._saveSession();
        return this.currentUser;
    }

    logout() { this._clearSession(); }

    getCurrentUser() {
        return this.currentUser;
    }

    get privateData() {
        if (!this.currentUser) throw new Error('Must be logged in');
        const ownerId = this.currentUser.id;
        const _prefix = (dataset) => `__user__${dataset}`;
        const _transform = (obj) => {
            if (!obj) return obj;
            const { __ownerID__, ...rest } = obj;
            return { ...rest, userID: __ownerID__ };
        };

        return {
            add: async (dataset, record) => {
                const { userID, ...clean } = record;
                return _transform(await this.client.add(_prefix(dataset), { ...clean, __ownerID__: ownerId }));
            },
            get: async (dataset, id, fields) => {
                const rec = await this.client.get(_prefix(dataset), id, fields);
                if (!rec || rec.__ownerID__ !== ownerId) throw new Error('Access denied');
                return _transform(rec);
            },
            update: async (dataset, id, updates) => {
                const existing = await this.client.get(_prefix(dataset), id);
                if (!existing || existing.__ownerID__ !== ownerId) throw new Error('Access denied');
                const { userID, ...safe } = updates;
                return _transform(await this.client.update(_prefix(dataset), id, safe));
            },
            delete: async (dataset, id) => {
                const existing = await this.client.get(_prefix(dataset), id);
                if (!existing || existing.__ownerID__ !== ownerId) throw new Error('Access denied');
                return this.client.delete(_prefix(dataset), id);
            },
            query: async (dataset, options = {}) => {
                const ownerFilter = `record.__ownerID__ === '${ownerId}'`;
                const combined = options.filter ? `(${ownerFilter}) && (${options.filter})` : ownerFilter;
                const res = await this.client.query(_prefix(dataset), { ...options, filter: combined });
                return { ...res, items: res.items.map(_transform) };
            }
        };
    }

    async sharePublic(dataset, recordId, expiresInSeconds) {
        if (!this.currentUser) throw new Error('Must be logged in');
        const key = 'share_' + Math.random().toString(36).substring(2, 10);
        await this.client.add('__shared__', { key, dataset, recordId, ownerId: this.currentUser.id, expiresAt: Date.now() + expiresInSeconds * 1000 });
        return { key, url: `?shared=${key}` };
    }

    async getPublic(shareKey) {
        const res = await this.client.query('__shared__', { filter: `record.key === '${shareKey}'` });
        if (!res.items.length) throw new Error('Invalid key');
        const share = res.items[0];
        if (Date.now() > share.expiresAt) throw new Error('Expired');
        const record = await this.client.get(`__user__${share.dataset}`, share.recordId);
        const { __ownerID__, ...rest } = record;
        return { ...rest, userID: __ownerID__ };
    }
}

// ---------- Socket 插件 (新增) ----------
class SocketPlugin {
    constructor(client) {
        this.client = client;
        this.socket = null;
        this.rooms = new Map(); // roomName -> SocketRoom 实例
        this._isConnecting = false;
    }

    // 获取 socket.io 引用 (兼容浏览器全局变量和 Node.js 环境)
    _getIO() {
        if (typeof io === 'function') return io;
        if (typeof require === 'function') return require('socket.io-client');
        throw new Error('Socket.io not found. Please include socket.io-client.');
    }

    // 建立连接
    connect() {
        if (this.socket && this.socket.connected) return this.socket;
        if (this._isConnecting) return null; // 防止并发连接

        const ioRef = this._getIO();
        this._isConnecting = true;

        this.socket = ioRef(this.client.baseURL, {
            auth: { appId: this.client.appID },
            transports: ['websocket', 'polling'],
        });

        this.socket.on('connect', () => {
            this._isConnecting = false;
            console.log(`[Socket] Connected: ${this.socket.id}`);
            // 重连后自动重新加入所有活跃房间
            this.rooms.forEach(room => room._rejoin());
        });

        this.socket.on('disconnect', () => {
            console.log('[Socket] Disconnected');
        });

        this.socket.on('connect_error', (err) => {
            this._isConnecting = false;
            console.error('[Socket] Connection Error:', err.message);
        });

        return this.socket;
    }

    // 创建或获取房间实例
    room(roomName, options = {}) {
        if (!this.socket) this.connect();

        if (!this.rooms.has(roomName)) {
            this.rooms.set(roomName, new SocketRoom(this, roomName, options));
        }
        return this.rooms.get(roomName);
    }

    // 断开连接
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.rooms.clear();
        }
    }
}

// ---------- SocketRoom 类 (逻辑封装) ----------
class SocketRoom {
    constructor(plugin, roomName, options = {}) {
        this.plugin = plugin;
        this.client = plugin.client;
        this.socket = plugin.socket;
        this.roomName = roomName;
        this.options = options; // { userRoom: boolean, ... }

        this._joined = false;
        this._listeners = new Set(); // 存储回调函数
    }

    // 加入房间
    join() {
        if (this._joined) return this;

        // 如果是用户房间，确保已登录
        if (this.options.userRoom) {
            const user = this.client.use('user').getCurrentUser();
            if (!user) {
                console.warn(`[Socket] Cannot join room "${this.roomName}" as userRoom: User not logged in.`);
                return this;
            }
        }

        this.socket.emit('joinRoom', this.roomName);
        this._joined = true;

        // 监听消息
        this.socket.on('roomMessage', this._handleMessage.bind(this));
        // 监听系统事件
        this.socket.on('userJoined', (data) => this._handleSystemEvent('userJoined', data));
        this.socket.on('userLeft', (data) => this._handleSystemEvent('userLeft', data));

        return this; // 支持链式调用
    }

    // 内部重连逻辑
    _rejoin() {
        if (this._joined) {
            this.socket.emit('joinRoom', this.roomName);
        }
    }

    // 发送消息
    send(data) {
        if (!this._joined) {
            console.warn('[Socket] Cannot send: not joined');
            return;
        }

        let payload = data;

        // 如果是用户房间，自动注入用户信息
        if (this.options.userRoom) {
            const user = this.client.use('user').getCurrentUser();
            if (user) {
                payload = {
                    __userData: data, // 原始数据包裹在 __userData 中
                    __sender: {
                        id: user.id,
                        username: user.username,
                        isAnonymous: user.isAnonymous
                    }
                };
            }
        }

        this.socket.emit('sendMessage', {
            roomName: this.roomName,
            message: payload
        });
    }

    // 监听消息
    onMessage(callback) {
        this._listeners.add(callback);
        return this; // 支持链式调用
    }

    // 内部消息处理器：自动拆解用户信息
    _handleMessage(rawData) {
        // 确保消息是当前房间的 (服务端已广播，双重保险)
        if (rawData.roomName !== this.roomName) return;

        let processedData = rawData;

        // 如果是用户房间，自动解析
        if (this.options.userRoom && rawData.message && rawData.message.__userData) {
            processedData = {
                data: rawData.message.__userData,        // 原始消息内容
                user: rawData.message.__sender,          // 发送者信息
                timestamp: rawData.timestamp,
                senderId: rawData.senderId
            };
        } else {
            // 普通房间，保持原样
            processedData = rawData;
        }

        // 触发所有监听器
        this._listeners.forEach(cb => {
            try { cb(processedData); } catch (e) { console.error('Socket callback error:', e); }
        });
    }

    // 处理系统事件
    _handleSystemEvent(event, data) {
        // 可以扩展 onUserJoined 等接口，这里暂时只在控制台打印
        console.log(`[Socket Event] ${event}`, data);
    }

    // 离开房间
    leave() {
        if (!this._joined) return;
        this.socket.emit('leaveRoom', this.roomName);
        this.socket.off('roomMessage', this._handleMessage);
        this._joined = false;
        this._listeners.clear();
    }
}

// 浏览器环境全局暴露
if (typeof window !== 'undefined') {
    window.CloudData = CloudData;
}