# CloudData SDK 文档

## 概述

CloudData SDK 是一个轻量级的云端数据存储客户端，为前端应用提供简单的数据持久化能力。它内置了 **user 插件** 和 **socket 插件**，方便开发者快速实现用户认证、私有数据管理、数据分享以及实时通信功能。

---

## 引入与初始化

### 1. 引入脚本

**标准模式（仅数据存储与用户系统）：**
```html
<script src="./js/clouddata.js"></script>
```

**实时通信模式（使用 Socket 插件）：**
如果需要使用实时消息功能，必须先引入 Socket.IO 客户端库。
```html
<script src="./js/lib/socket.io-client.min.js"></script> <!-- 前置依赖 -->
<script src="./js/clouddata.js"></script>
```

### 2. 初始化实例

直接创建实例即可。

```javascript
const cloud = new CloudData();
```

---

## 核心数据操作（所有应用可用）

以下方法直接操作数据集，不涉及用户身份。每条记录会自动包含 `id`、`_createdAt`、`_updatedAt` 字段。

### `add(dataset, record)`
- **功能**：向指定数据集中添加一条记录。
- **参数**：
  - `dataset`：字符串，数据集名称。
  - `record`：对象，要存储的数据。
- **返回**：Promise，解析为创建后的完整记录对象。

### `get(dataset, id, fields?)`
- **功能**：根据 ID 获取单条记录。
- **参数**：`dataset`（数据集名）、`id`（记录ID）、`fields`（可选，指定返回字段）。
- **返回**：Promise，解析为记录对象。

### `update(dataset, id, record)`
- **功能**：更新指定记录（合并更新）。
- **参数**：`dataset`、`id`、`record`（要更新的字段）。
- **返回**：Promise，解析为更新后的完整记录对象。

### `delete(dataset, id)`
- **功能**：删除指定记录。
- **返回**：Promise，成功时解析为 `null`。

### `batchGet(dataset, ids, fields?)`
- **功能**：批量获取多条记录。
- **参数**：`ids`（ID数组）、`fields`（可选）。
- **返回**：Promise，解析为记录数组 `items`。

### `query(dataset, options)`
- **功能**：根据条件查询记录。
- **参数**（`options` 对象）：
  - `filter`：可选，字符串，JS 表达式（如 `record.age > 18`）。
  - `sort`：可选，对象（如 `{ age: -1 }`）。
  - `limit` / `offset`：可选，分页控制。
- **返回**：Promise，解析为 `{ items, total }`。

---

## user 插件

通过 `cloud.use('user')` 获取插件实例。

```javascript
const user = cloud.use('user');
```

### 用户状态与会话
- SDK 内部使用 `localStorage` 持久化会话，刷新页面自动恢复。
- 用户信息包含 `id`、`isAnonymous`、`username` 等字段。

### 方法列表

#### `initAnonymous({ overwrite })`
- **功能**：初始化匿名用户。
- **参数**：`overwrite` 为 `true` 时强制创建新用户覆盖当前会话。
- **返回**：Promise，解析为当前用户对象。

#### `register({ username, password })`
- **功能**：注册并自动登录。
- **返回**：Promise，解析为用户对象。

#### `login({ username, password })`
- **功能**：登录。
- **返回**：Promise，解析为用户对象。

#### `logout()`
- **功能**：登出并清除会话。

#### `getCurrentUser()`
- **功能**：同步获取当前用户对象（可能为 `null`）。

### 私有数据操作（`user.privateData`）

自动关联当前用户，无需手动过滤，对外展示 `userID` 字段。必须在已登录（含匿名）状态下调用。

- **`add(dataset, record)`**：添加私有记录。
- **`get(dataset, id, fields?)`**：获取私有记录（自动鉴权）。
- **`update(dataset, id, updates)`**：更新私有记录。
- **`delete(dataset, id)`**：删除私有记录。
- **`query(dataset, options)`**：查询私有记录（自动附带所有者过滤）。

### 数据分享功能

#### `sharePublic(dataset, recordId, expiresInSeconds)`
- **功能**：分享私有记录。
- **返回**：Promise，解析为 `{ key, expiresAt }`。

#### `getPublic(shareKey)`
- **功能**：获取公开分享的记录。
- **返回**：Promise，解析为记录对象。

---

## socket 插件 (新增)

通过 `cloud.use('socket')` 获取插件实例，提供实时通信能力。该插件与 `user` 插件深度整合，支持“用户房间”模式。

```javascript
const socket = cloud.use('socket');
```

### 基础概念

- **Room（房间）**：通信的基本单位。客户端需先加入房间才能收发消息。
- **UserRoom（用户房间）**：开启此模式后，SDK 会自动在发送消息时附带用户信息，接收消息时自动解析，极大简化开发。

### 方法列表

#### `room(roomName, options)`
- **功能**：获取房间实例。支持链式调用。
- **参数**：
  - `roomName`：字符串，房间名称。
  - `options`：对象，配置项。
    - `userRoom`：布尔值，默认 `false`。若为 `true`，开启用户房间模式。
- **返回**：`SocketRoom` 实例。

#### `disconnect()`
- **功能**：断开 Socket 连接。

---

### SocketRoom 实例方法

通过 `socket.room(...)` 获取实例后，可调用以下方法：

#### `join()`
- **功能**：加入房间。
- **返回**：返回实例自身（支持链式调用）。
- **注意**：如果是 `userRoom` 模式且用户未登录，加入操作将被警告并忽略。

#### `send(data)`
- **功能**：向房间发送消息。
- **参数**：`data` 为任意可序列化对象。
- **行为**：
  - 普通模式：直接发送 `data`。
  - **UserRoom 模式**：自动注入当前用户信息，接收方无需手动解析。

#### `onMessage(callback)`
- **功能**：监听房间消息。
- **参数**：`callback` 回调函数。
- **回调参数**：
  - 普通模式：接收原始消息对象。
  - **UserRoom 模式**：接收自动解析后的对象，格式为：
    ```javascript
    {
      data: { ... },        // 发送方发送的原始数据
      user: {               // 发送方用户信息
        id: "...",
        username: "...",
        isAnonymous: false
      },
      timestamp: "...",     // 时间戳
      senderId: "..."       // Socket ID
    }
    ```

#### `leave()`
- **功能**：离开房间并清理监听。

---

## 使用示例

### 示例 1：匿名用户保存笔记
```javascript
const cloud = new CloudData();
const user = cloud.use('user');

await user.initAnonymous();

const note = await user.privateData.add('notes', {
  title: '我的第一个笔记',
  content: 'Hello world'
});
console.log('笔记已保存，ID:', note.id, '所有者:', note.userID);
```

### 示例 2：注册用户并分享笔记
```javascript
const cloud = new CloudData();
const user = cloud.use('user');

await user.register({ username: 'alice', password: '123456' });

const note = await user.privateData.add('notes', {
  title: '公开笔记',
  content: '这是要分享的内容'
});

const share = await user.sharePublic('notes', note.id, 3600);
console.log('分享密钥:', share.key);
```

### 示例 3：实时聊天室（UserRoom 模式）

此示例展示如何利用 `socket` 插件快速构建聊天功能。无需手动处理用户身份的传递与解析。

```javascript
const cloud = new CloudData();
const user = cloud.use('user');
const socket = cloud.use('socket');

// 1. 确保用户已登录
await user.login({ username: 'bob', password: '123456' });

// 2. 获取房间实例，开启 userRoom 模式
const chatRoom = socket.room('game-chat-01', { userRoom: true });

// 3. 加入房间并监听消息
chatRoom.join().onMessage(msg => {
    // msg 已自动解析：msg.data 是内容，msg.user 是发送者
    const { user, data } = msg;
    console.log(`[收到] ${user.username}: ${data.text}`);
});

// 4. 发送消息
// 只需传内容，SDK 会自动附带 user 信息发送给服务端

chatRoom.send({ 
    text: '大家好，我是新来的！' 
});

// 使用Data操作在数据集持久化消息...
```

---

## 注意事项

- **错误处理**：所有异步操作建议使用 `try...catch` 包裹，错误对象包含 `message`、`status` 属性。
- **Socket 依赖**：使用 `socket` 插件前，请务必在 HTML 中引入 `socket.io-client` 库。
- **用户体验**：建议在界面展示时优先使用 `username` 而非 `id`，提升用户辨识度。
- **数据集变化**：CloudData SDK 的Data部分不内置数据集变化的监听方法，开发者需自行结合Data操作和Socket插件，这主要是出于性能原因和功能解耦的考虑。