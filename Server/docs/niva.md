# Niva 框架开发参考

## 项目配置 (niva.json)

下面的配置大多为可选项，不需要时请不要填写

```json
{
  "name": "App-name", // 只能包含英文、数字、连字符
  "uuid": "uuid", // 应用唯一标识符
  "meta": {
    "version": "1.0.0", // 应用版本号
    "name": "产品名称", // 用于InternalName, OriginalFilename, ProductName字段
    "copyright": "版权信息", // 版权描述
    "description": "应用描述", // 仅Windows
    "companyName": "公司名称" // 仅Windows
  },
  "window": {
    "entry": "index.html", // 应用入口文件路径
    "title": "窗口标题",
    "theme": "system", // 窗口主题：light/dark/system
    "size": { "width": 800, "height": 600 }, // 窗口大小
    "minSize": { "width": 400, "height": 300 }, // 最小尺寸
    "maxSize": { "width": 1200, "height": 800 }, // 最大尺寸
    "position": { "x": 100, "y": 100 }, // 窗口位置
    "resizable": true, // 是否可调整大小
    "minimizable": true, // 是否可最小化
    "maximizable": true, // 是否可最大化
    "closable": true, // 是否可关闭
    "fullscreen": false, // 是否全屏
    "maximized": false, // 是否最大化
    "visible": true, // 是否可见
    "transparent": false, // 是否透明
    "decorations": true, // 是否显示窗口装饰
    "alwaysOnTop": false, // 是否始终置顶
    "alwaysOnBottom": false, // 是否始终置底
    "visibleOnAllWorkspaces": false, // 是否在多个工作区显示
    "focused": true, // 是否聚焦
    "contentProtection": false, // 是否启用内容保护
    "devtools": false, // 是否启用开发者工具

    "menu": {
      "label": "name", // 根菜单项的名称
      "enabled": true, // 是否启用菜单项
      "children": "<Object>MenuOptions" // 子菜单项
    }
  }
}
```

MenuOptions详情：
```ts
// 系统原生菜单项标签枚举类型。
enum NativeLabel {
  Hide, // 显示 "Hide"
  Services, // 显示 "Services"
  HideOthers, // 显示 "Hide Others"
  ShowAll, // 显示 "Show All"
  CloseWindow, // 显示 "Close Window"
  Quit, // 显示 "Quit"
  Copy, // 显示 "Copy"
  Cut, // 显示 "Cut"
  Undo, // 显示 "Undo"
  Redo, // 显示 "Redo"
  SelectAll, // 显示 "Select All"
  Paste, // 显示 "Paste"
  EnterFullScreen, // 显示 "Enter Full Screen"
  Minimize, // 显示 "Minimize"
  Zoom, // 显示 "Zoom"
  Separator, // 表示一个分隔线
}

// 菜单项选项枚举类型。
type MenuItemOption =
  | { type: "native"; label: NativeLabel } // 本地菜单选项
  | {
      type: "item";
      id: number;
      label: string; // 显示的文本
      enabled?: boolean; // 是否启用
      selected?: boolean; // 是否选中
      accelerator?: string; // 快捷键
    } // 自定义菜单选项
  | { type: "menu"; label: string; enabled?: boolean; children: MenuOptions }; // 子菜单选项

// 菜单选项列表。
type MenuOptions = MenuItemOption[];
```

## 核心 API 参考

注意，Niva 框架的 API 都是异步的，需要使用 `await` 关键字来等待结果，但注意：避免在同步函数中使用 await 关键字的错误。

### 基础 API

```js
// 事件监听
Niva.addEventListener("event.name", (eventName, payload) => {});
Niva.removeEventListener("event.name", listener);
Niva.removeAllEventListeners("event.name");

// API语法
const result = await Niva.api.namespace.method(arg1, arg2);
```

### 窗口管理

```js
// 获取当前窗口ID
const windowId = await Niva.api.window.current();

// 打开新窗口
const newWindowId = await Niva.api.window.open({
  title: "新窗口",
  size: { width: 400, height: 300 },
  position: { x: 100, y: 100 },
  resizable: true,
  minimizable: true,
  maximizable: true,
  closable: true,
  decorations: true,
});

// 关闭窗口（id为0时退出程序）
await Niva.api.window.close(windowId);

// 获取窗口列表
const windows = await Niva.api.window.list();
// 返回: [{id: number, title: string, visible: boolean}]

// 窗口消息通信
await Niva.api.window.sendMessage("Hello", targetWindowId);

// 窗口菜单管理
await Niva.api.window.setMenu(menuOptions, windowId);
await Niva.api.window.hideMenu(windowId);
await Niva.api.window.showMenu(windowId);
const isVisible = await Niva.api.window.isMenuVisible(windowId);

// 窗口状态控制
await Niva.api.window.setTitle("新标题", windowId);
const title = await Niva.api.window.title(windowId);

await Niva.api.window.setVisible(false, windowId); // 隐藏窗口
const isVisible = await Niva.api.window.isVisible(windowId);

await Niva.api.window.setFocus(windowId); // 聚焦窗口
const isFocused = await Niva.api.window.isFocused(windowId);

await Niva.api.window.setMinimized(true, windowId); // 最小化
const isMinimized = await Niva.api.window.isMinimized(windowId);

await Niva.api.window.setMaximized(true, windowId); // 最大化
const isMaximized = await Niva.api.window.isMaximized(windowId);

await Niva.api.window.setFullscreen(true, "显示器名称", windowId); // 全屏
const isFullscreen = await Niva.api.window.isFullscreen(windowId);

// 窗口尺寸和位置
const scaleFactor = await Niva.api.window.scaleFactor(windowId);
const innerPosition = await Niva.api.window.innerPosition(windowId);
const outerPosition = await Niva.api.window.outerPosition(windowId);
await Niva.api.window.setOuterPosition({ x: 100, y: 100 }, windowId);

const innerSize = await Niva.api.window.innerSize(windowId);
const outerSize = await Niva.api.window.outerSize(windowId);
await Niva.api.window.setInnerSize({ width: 800, height: 600 }, windowId);
await Niva.api.window.setMinInnerSize({ width: 400, height: 300 }, windowId);
await Niva.api.window.setMaxInnerSize({ width: 1200, height: 800 }, windowId);

// 窗口属性设置
await Niva.api.window.setResizable(false, windowId);
await Niva.api.window.setMinimizable(false, windowId);
await Niva.api.window.setMaximizable(false, windowId);
await Niva.api.window.setClosable(false, windowId);
await Niva.api.window.setDecorated(false, windowId);
await Niva.api.window.setAlwaysOnTop(true, windowId);
await Niva.api.window.setAlwaysOnBottom(true, windowId);
await Niva.api.window.setContentProtection(true, windowId);
await Niva.api.window.setVisibleOnAllWorkspaces(true, windowId);

// 光标控制
await Niva.api.window.setCursorIcon("pointer", windowId);
const cursorPos = await Niva.api.window.cursorPosition(windowId);
await Niva.api.window.setCursorPosition({ x: 100, y: 100 }, windowId);
await Niva.api.window.setCursorGrab(true, windowId);
await Niva.api.window.setCursorVisible(false, windowId);
await Niva.api.window.setIgnoreCursorEvents(true, windowId);
await Niva.api.window.dragWindow(windowId); // 开始拖动窗口

// 用户关注请求
await Niva.api.window.requestUserAttention("critical", windowId);

// 获取窗口主题
const theme = await Niva.api.window.theme(windowId);
// 返回: "light" | "dark" | "system"
```

### 窗口额外功能（平台特定）

```js
// Windows特有功能
await Niva.api.windowExtra.setEnable(true, windowId); // 启用/禁用窗口
await Niva.api.windowExtra.setSkipTaskbar(true, windowId); // 隐藏任务栏图标
await Niva.api.windowExtra.setUndecoratedShadow(true, windowId); // 无装饰窗口阴影
await Niva.api.windowExtra.resetDeadKeys(windowId); // 重置死键
await Niva.api.windowExtra.beginResizeDrag(edge, button, x, y, windowId); // 开始缩放拖动
```

### 文件系统

```js
// 文件信息
const info = await Niva.api.fs.stat("/path/to/file");
// 返回: {
//   isDir: boolean,
//   isFile: boolean,
//   isSymlink: boolean,
//   size: number,
//   modified: number,
//   accessed: number,
//   created: number
// }

// 检查文件存在
const exists = await Niva.api.fs.exists("/path/to/file");

// 读取文件
const textContent = await Niva.api.fs.read("/path/to/file.txt", "utf8");
const binaryData = await Niva.api.fs.read("/path/to/file.bin", "base64");
// 返回: base64编码字符串

// 写入文件
await Niva.api.fs.write("/path/to/file.txt", "内容", "utf8");
await Niva.api.fs.write("/path/to/file.bin", base64String, "base64");

// 追加文件内容
await Niva.api.fs.append("/path/to/file.txt", "追加内容", "utf8");

// 文件操作
const options = {
  overwrite: true, // 覆盖已存在文件
  skipExist: false, // 跳过已存在文件
  copyInside: false, // 复制到目标内部
  contentOnly: false, // 仅复制内容
  depth: 0, // 递归深度
};

await Niva.api.fs.copy("/source", "/destination", options);
await Niva.api.fs.move("/source", "/destination", options); // 可用于 rename
await Niva.api.fs.remove("/path/to/file");

// 目录操作
await Niva.api.fs.createDir("/path/to/dir"); // 创建单级目录
await Niva.api.fs.createDirAll("/path/to/deep/dir"); // 递归创建目录

const files = await Niva.api.fs.readDir("/path/to/dir");
// 返回: string[] - 目录中文件和子目录名称

const allFiles = await Niva.api.fs.readDirAll("/path/to/dir", [
  "*.tmp",
  "temp/*",
]);
// 返回: string[] - 所有文件的相对路径（排除指定模式）
```

### 网络请求

```js
// HTTP请求

// 建议使用浏览器原生fetch，除非明确受跨域限制
const response = await Niva.api.http.fetch({
  url: "https://api.example.com/data",
  method: "GET", // GET, POST, PUT, DELETE等
  headers: {
    Authorization: "Bearer token",
    "Content-Type": "application/json",
  },
  bodyType: "text", // "text" 或 "binary"
  body: JSON.stringify({ key: "value" }), // 请求体
  proxy: "http://proxy.example.com:8080", // 代理服务器
  responseType: "text", // "text" 或 "binary"
});

// 返回: {
//   status: number,           // HTTP状态码
//   statusText: string,       // 状态文本
//   ok: boolean,              // 是否成功(200-299)
//   headers: { [key: string]: string }, // 响应头
//   url: string,              // 最终请求URL
//   response: {
//     body: string,           // 响应体内容
//     bodyType: "text" | "base64" // 响应体类型
//   }
// }

// 二进制请求示例
const binaryResponse = await Niva.api.http.fetch({
  url: "https://example.com/image.jpg",
  responseType: "binary",
});
// binaryResponse.response.body 为base64字符串

// 发送二进制数据
await Niva.api.http.fetch({
  url: "https://api.example.com/upload",
  method: "POST",
  bodyType: "binary",
  body: base64Data,
  headers: {
    "Content-Type": "image/jpeg",
  },
});
```

### 进程管理

```js
// 进程信息
const pid = await Niva.api.process.pid(); // 当前进程ID
const currentDir = await Niva.api.process.currentDir(); // 当前工作目录
const currentExe = await Niva.api.process.currentExe(); // 当前可执行文件路径
const env = await Niva.api.process.env(); // 环境变量
const args = await Niva.api.process.args(); // 命令行参数
const version = await Niva.api.process.version(); // Niva版本

// 进程控制
await Niva.api.process.setCurrentDir("/new/path"); // 设置工作目录
await Niva.api.process.exit(); // 退出程序
await Niva.api.process.open("https://example.com | qqmusic://"); // 打开URI

// 执行命令
const result = await Niva.api.process.exec("echo", ["hello", "world"], {
  env: { CUSTOM_VAR: "value" }, // 环境变量
  current_dir: "./", // 工作目录
  silent: false, // 静默执行，建议指定为true
});
// 返回: {
//   status: number | null, // 退出状态码
//   stdout: string,        // 标准输出
//   stderr: string         // 标准错误
// }
```

### 系统对话框

```js
// 消息框
await Niva.api.dialog.showMessage("标题", "内容", "info");
// level: 'info' | 'warning' | 'error'

// 文件选择
const file = await Niva.api.dialog.pickFile(
  ["*.txt", "*.json"], // 文件过滤器
  "D:/downloads" // 初始目录（可选）
); // 返回: string | null

// 文件多选
const files = await Niva.api.dialog.pickFiles(
  ["*.png", "*.jpg"],
  "D:/downloads"
); // 返回文件路径数组: string[] | null

// 目录选择
const dir = await Niva.api.dialog.pickDir("D:/downloads"); // 返回: string | null
const dirs = await Niva.api.dialog.pickDirs("D:/downloads"); // 返回: string[] | null

// 保存文件
const savePath = await Niva.api.dialog.saveFile(["*.txt"], "D:/downloads"); // 返回: string | null
```

### 剪切板

```js
// 读取剪切板文本
const text = await Niva.api.clipboard.read();
// 返回: string | null

// 写入剪切板文本
await Niva.api.clipboard.write("要复制的文本");
```

### 系统信息

```js
// 操作系统信息
const osInfo = await Niva.api.os.info();
// 返回: { os: string, arch: string, version: string }

// 系统目录
const dirs = await Niva.api.os.dirs();
// 返回: {
//   temp: string,      // 临时目录
//   data: string,      // 数据目录
//   home?: string,     // 用户主目录
//   audio?: string,    // 音频目录
//   desktop?: string,  // 桌面目录
//   document?: string, // 文档目录
//   download?: string, // 下载目录
//   font?: string,     // 字体目录
//   picture?: string,  // 图片目录
//   public?: string,   // 公共目录
//   template?: string, // 模板目录
//   video?: string     // 视频目录
// }

// 系统常量
const separator = await Niva.api.os.sep(); // 路径分隔符
const eol = await Niva.api.os.eol(); // 换行符
const locale = await Niva.api.os.locale(); // 系统区域设置
```

### 监视器信息

```js
// 获取所有监视器
const monitors = await Niva.api.monitor.list();
// 返回: [{
//   name: string,
//   size: { width: number, height: number },
//   position: { x: number, y: number },
//   physicalSize: { width: number, height: number },
//   physicalPosition: { x: number, y: number },
//   scaleFactor: number
// }]

// 获取当前窗口所在监视器
const currentMonitor = await Niva.api.monitor.current();

// 获取主监视器
const primaryMonitor = await Niva.api.monitor.primary();

// 根据坐标获取监视器
const monitorAtPoint = await Niva.api.monitor.fromPoint(100, 100);
```

### 系统额外功能

```js
// 窗口焦点控制
const activeWindowId = await Niva.api.extra.getActiveWindowId();
// 返回: 窗口句柄字符串

const success = await Niva.api.extra.focusByWindowId(windowIdString);
// 返回: boolean - 是否成功设置焦点
```

### Webview 控制

```js
// 基础URL
const baseUrl = await Niva.api.webview.baseUrl();
const baseFileSystemUrl = await Niva.api.webview.baseFileSystemUrl();
```

### 应用资源访问（基于项目根目录）

```js
// 检查资源存在
const exists = await Niva.api.resource.exists("assets/data.json");

// 读取资源文件
const content = await Niva.api.resource.read("config.txt", "utf8");
const binaryContent = await Niva.api.resource.read("image.png", "base64");

// 提取资源到文件系统
await Niva.api.resource.extract("data.db", "C:/Users/user/Documents/data.db");
```

### 全局快捷键

```js
// 注册快捷键
const shortcutId = await Niva.api.shortcut.register(
  "Ctrl+Shift+A",
  windowId // 可选窗口ID
);

// 快捷键管理
await Niva.api.shortcut.unregister(shortcutId, windowId);
await Niva.api.shortcut.unregisterAll(windowId);
const shortcuts = await Niva.api.shortcut.list(windowId);
// 返回: { id: number, accelerator: string }[]
```

## 事件监听

```js
// 窗口事件
Niva.addEventListener("window.focused", (eventName, focused) => {
  // focused: boolean - 窗口是否获得焦点
});

Niva.addEventListener("window.scaleFactorChanged", (eventName, payload) => {
  // payload: {
  //   scaleFactor: number,
  //   newInnerSize: { width: number, height: number }
  // }
});

Niva.addEventListener("window.themeChanged", (eventName, theme) => {
  // theme: "light" | "dark" | "system"
});

Niva.addEventListener("window.closeRequested", (eventName, payload) => {
  // 返回false阻止窗口关闭
  return false;
});

Niva.addEventListener("window.message", (eventName, payload) => {
  // payload: { from: number, message: string }
});

// 菜单事件
Niva.addEventListener("menu.clicked", (eventName, menuId) => {
  switch (menuId) {
    case 1:
      // 处理菜单点击
      break;
    case 100:
      await Niva.api.window.setVisible(true);
      break;
    case 101:
      await Niva.api.process.exit();
      break;
  }
});

// 全局快捷键事件
Niva.addEventListener("shortcut.emit", (eventName, shortcutId) => {
  // 快捷键被触发
  switch (shortcutId) {
    case 1:
      // 处理快捷键1
      break;
  }
});

// 文件拖拽事件
Niva.addEventListener("fileDrop.hovered", (eventName, payload) => {
  // payload: {
  //   paths: string[],
  //   position: { x: number, y: number }
  // }
});

Niva.addEventListener("fileDrop.dropped", (eventName, payload) => {
  // 文件被放置到窗口
  const { paths, position } = payload;
  // 处理拖放的文件
});

Niva.addEventListener("fileDrop.cancelled", (eventName, payload) => {
  // 文件拖拽被取消
});
```

## 二进制数据处理

```js
// Base64编码解码（使用浏览器原生API）
const base64Data = await Niva.api.fs.read("file.bin", "base64");
const binaryString = atob(base64Data); // Base64解码
const encodedData = btoa(binaryString); // Base64编码

// 处理HTTP二进制响应
const binaryResponse = await Niva.api.http.fetch({
  url: "https://example.com/file",
  responseType: "binary",
});
const binaryData = binaryResponse.response.body; // base64字符串

// 二进制数据转换示例
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(uint8Array) {
  let binary = "";
  const len = uint8Array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}
```

## nivautils.js

`nivautils.js` 是一个工具库，里面封装了一些常用的逻辑，最常用的是 `setDraggable` 函数，常搭配`"decorations": false`（无边框） `"undecoratedShadow": true`（Windows11的圆角效果） `Niva.api.window.setMinimized` `Niva.api.window.close`（按钮逻辑）等实现自定义标题栏以获得更好的 UI 效果

```js
/**
 * function setDraggable
 * 设置DOM元素是否可拖动（用于窗口拖动）
 * @param {HTMLElement} domElement - 需要控制拖动的DOM元素
 * @param {boolean} draggable - 是否启用拖动功能
 */
```