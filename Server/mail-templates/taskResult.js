// mail-templates/taskResult.js
module.exports = function renderTaskResult({
    isSuccess,
    requirement,
    completionTime,
    taskDetailUrl,
    fileURL,
    expiresIn,
    size,
    failureReason
}) {
    const successBlock = isSuccess ? `
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
            style="background-color: #f0f8ff; border: 1px solid #d0e6f5; margin-bottom: 32px;">
            <tr>
                <td style="padding: 16px;">
                    <div style="font-size: 14px; color: #0078D4; margin-bottom: 8px;">可执行文件下载链接（有效期 ${expiresIn} 小时）：</div>
                    <a href="${fileURL}" style="font-size: 14px; color: #0078D4; word-break: break-all;">${fileURL}</a>
                    <div style="font-size: 13px; color: #666666; margin-top: 8px;">文件大小：${size} MB</div>
                </td>
            </tr>
        </table>
    ` : `
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
            style="background-color: #fff0f0; border: 1px solid #ffd0d0; margin-bottom: 32px;">
            <tr>
                <td style="padding: 16px;">
                    <div style="font-size: 14px; color: #d40000; margin-bottom: 8px;">失败原因：</div>
                    <div style="font-size: 14px; color: #333333;">${failureReason}</div>
                </td>
            </tr>
        </table>
    `;

    const detailLink = taskDetailUrl ? `<a href="${taskDetailUrl}" style="color: #0078D4; text-decoration: none; font-weight: 500;">前往查看任务详情</a>` : '';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>任务完成通知</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', 'Roboto', system-ui, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f5f5; width: 100%;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0"
                    style="max-width: 480px; width: 100%; background-color: #ffffff; border: 1px solid #e0e0e0; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
                    <tr>
                        <td style="padding: 32px 32px 24px 32px;">
                            <div style="font-size: 24px; font-weight: 600; color: #0078D4; margin-bottom: 16px; letter-spacing: -0.5px;">
                                YeXin - 应用生成
                            </div>
                            <div style="font-size: 20px; font-weight: 500; color: #333333; margin-bottom: 24px;">
                                ${isSuccess ? '任务完成' : '任务处理失败'}
                            </div>
                            <div style="font-size: 14px; color: #666666; line-height: 1.6; margin-bottom: 32px;">
                                您的任务“${requirement}”已于 ${completionTime} 处理${isSuccess ? '成功' : '失败'}。
                            </div>
                            ${successBlock}
                            <div style="font-size: 13px; color: #999999; border-top: 1px solid #eeeeee; padding-top: 24px; text-align: center;">
                                ${detailLink}
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #fafafa; padding: 16px 32px; border-top: 1px solid #eeeeee; font-size: 12px; color: #aaaaaa; text-align: left;">
                            © 2026 YeXin. All rights reserved.
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};