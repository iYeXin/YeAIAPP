async function getCloudDataInfo(config) {
    if (!config.baseURL || !config.apiKey) {
        throw new Error("baseURL and apiKey are required")
    }
    const baseURL = config.baseURL.replace(/\/+$/, '') + '/'
    try {
        const resp = await fetch(baseURL + 'apply-app', {
            method: 'POST',
            headers: {
                'X-Key': config.apiKey
            }
        })
        const { appId } = await resp.json()
        return {
            baseURL,
            appID: appId
        }
    } catch (error) {
        throw new Error('Failed to get appID from cloud: ' + error.message)
    }
}

module.exports = getCloudDataInfo