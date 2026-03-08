async function buildApp(app, config, iconBuffer, couldDataConfig) {
    const { buildServerURL, buildKey } = config;
    const url = `${buildServerURL.replace(/\/+$/, '')}/${buildKey}/`;
    const project = constructProject(app, iconBuffer, couldDataConfig);
    const { success, download_url, expires_in, size } = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(project),
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => response.json())
    return { fileURL: buildServerURL.replace(/\/+$/, '') + download_url, expiresIn: expires_in, size, success };
}

function constructProject(app, iconBuffer, couldDataConfig) {
    const project = {
        src: app.src,
        config: { ...app.config, icon: 'assets/icon.png', window: { ...app.config.window, icon: 'assets/icon.png', devtools: false } },
        icon: iconBuffer.toString('base64'),
        couldDataConfig: couldDataConfig
    }
    return project;
}

module.exports = buildApp;