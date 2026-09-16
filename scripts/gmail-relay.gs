function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (!secret || data.secret !== secret) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    const to = String(data.to || '').trim();
    const subject = String(data.subject || '').trim();
    if (!to || !subject) {
      return json_({ ok: false, error: 'invalid' });
    }
    const options = {
      htmlBody: data.html || data.text || '',
      name: data.fromName || 'Contabiliza'
    };
    if (data.replyTo) options.replyTo = String(data.replyTo);
    MailApp.sendEmail(to, subject, data.text || subject, options);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
