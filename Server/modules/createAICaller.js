// callAI.js
const OpenAI = require('openai');

/**
 * 创建 AI 请求器
 * @param {Object} options - 配置选项
 * @param {string} options.type - 服务类型，目前仅支持 'openai'
 * @param {Object} options.client - 客户端配置
 * @param {string} options.client.baseURL - API 基础地址
 * @param {string} options.client.apiKey - API 密钥
 * @param {Object} options.chat - 聊天补全默认参数
 * @param {string} options.chat.model - 模型名称
 * @param {number} options.chat.max_tokens - 最大生成 token 数
 * @param {number} options.chat.temperature - 温度参数
 * @returns {Function} 请求器函数 (systemPrompt, userMessage) => Promise<string>
 */
function createAICaller(options) {
    const { type, client, chat } = options;

    if (type !== 'openai') {
        throw new Error(`Unsupported AI type: "${type}". Currently only "openai" is supported.`);
    }

    if (!client?.baseURL || !client?.apiKey) {
        throw new Error('Missing required client configuration: baseURL and apiKey are required.');
    }

    // 初始化 OpenAI 客户端
    const openai = new OpenAI({
        baseURL: client.baseURL,
        apiKey: client.apiKey,
    });

    // 保存聊天补全的默认参数（如 model, max_tokens, temperature 等）
    const defaultChatParams = { ...chat };

    /**
     * 请求器函数
     * @param {string} systemPrompt - 系统提示词
     * @param {string} userMessage - 用户消息
     * @returns {Promise<string>} AI 回复的文本内容
     */
    return async function request(systemPrompt, userMessage) {
        try {
            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ];

            const completion = await openai.chat.completions.create({
                ...defaultChatParams,
                messages,
            });

            // 提取回复文本，若为空则返回空字符串
            return completion.choices[0]?.message?.content ?? '';
        } catch (error) {
            // 可根据需要自定义错误处理（如重试、日志等），这里直接抛出
            throw new Error(`AI request failed: ${error.message}`);
        }
    };
}

module.exports = createAICaller;