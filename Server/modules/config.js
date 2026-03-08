const keys = {
    llmAPIKey1: '',
    llmAPIKey2: '',
    couldDataAPIKey: '',
    buildServerAPIKey: ''
}

const configs = {
    cloudData: {
        baseURL: '',
        apiKey: keys.couldDataAPIKey
    },
    buildServer: {
        buildServerURL: '',
        buildKey: keys.buildServerAPIKey
    },
    models: {
        clarificator: {
            type: 'openai',
            client: {
                baseURL: 'https://api.deepseek.com',
                apiKey: keys.llmAPIKey1,
            },
            chat: {
                model: 'deepseek-reasoner',
                max_tokens: 16 * 1024,
                temperature: 0.7,
                response_format: { type: 'json_object' }
            }
        },
        coder: {
            type: 'openai',
            client: {
                baseURL: 'https://api.deepseek.com',
                apiKey: keys.llmAPIKey2,
            },
            chat: {
                model: 'deepseek-reasoner',
                max_tokens: 64 * 1024,
                temperature: 0.7,
                response_format: { type: 'json_object' }
            }
        }
    }
}

module.exports = configs;