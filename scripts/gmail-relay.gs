function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (!secret || data.secret !== secret) {
      return json_({ ok: false, error: 'unauthorized' });
    }

    const action = String(data.action || 'sendEmail');
    if (action === 'saveLicenses') {
      saveLicenses_(Array.isArray(data.licenses) ? data.licenses : []);
      return json_({ ok: true });
    }
    if (action === 'loadLicenses') {
      return json_({ ok: true, licenses: loadLicenses_() });
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

function saveLicenses_(licenses) {
  const json = JSON.stringify(licenses);
  const chunkSize = 8000;
  const props = PropertiesService.getScriptProperties();
  const previous = Number(props.getProperty('licenses_n') || '0');
  const chunks = [];
  for (let i = 0; i < json.length; i += chunkSize) {
    chunks.push(json.slice(i, i + chunkSize));
  }
  props.setProperty('licenses_n', String(chunks.length));
  chunks.forEach(function (chunk, index) {
    props.setProperty('licenses_' + index, chunk);
  });
  for (let i = chunks.length; i < previous; i += 1) {
    props.deleteProperty('licenses_' + i);
  }
}

function loadLicenses_() {
  const props = PropertiesService.getScriptProperties();
  const count = Number(props.getProperty('licenses_n') || '0');
  if (!count) return [];
  let json = '';
  for (let i = 0; i < count; i += 1) {
    json += props.getProperty('licenses_' + i) || '';
  }
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
