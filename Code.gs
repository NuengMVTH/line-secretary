const LINE_TOKEN = 'ใส่ LINE token ของนาย';
const CALENDAR_ID = 'primary';
const OPENAI_KEY = 'ใส่ OpenAI key ของนาย';

// ─────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const evt = body.events && body.events[0];
    if (!evt || evt.type !== 'message' || evt.message.type !== 'text') return ok();
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('USER_ID')) props.setProperty('USER_ID', evt.source.userId);
    const text = evt.message.text.trim();
    if (/^ตั้งชื่อ\s/.test(text)) {
      const name = text.replace(/^ตั้งชื่อ\s+/, '').trim();
      const props2 = PropertiesService.getScriptProperties();
      const profile2 = JSON.parse(props2.getProperty('USER_PROFILE') || '{}');
      profile2['ชื่อบอท'] = name;
      props2.setProperty('USER_PROFILE', JSON.stringify(profile2));
      reply(evt.replyToken, '✅ ตั้งชื่อเป็น "' + name + '" แล้วค่ะ');
      return ok();
    }
    if (/^(ยกเลิก|ลบนัด|ลบ)/.test(text)) { handleCancel(text, evt.replyToken); return ok(); }
    if (/^(ดูนัด|เช็คนัด|นัดวัน|มีนัด|ตารางนัด|วีคนี้|สัปดาห์นี้|สัปดาห์หน้า|เดือนนี้)|นัด.*(สัปดาห์|วีค|เดือน)|มีนัด/.test(text)) { handleViewEvents(text, evt.replyToken); return ok(); }
    if (/^(แก้นัด|เปลี่ยนนัด|ย้ายนัด|แก้ไขนัด)/.test(text)) { handleEditEvent(text, evt.replyToken); return ok(); }
    const parsed = parseAppointmentWithAI(text);
    if (parsed) {
      CalendarApp.getCalendarById(CALENDAR_ID).createEvent(parsed.title, parsed.start, parsed.end);
      const ds = Utilities.formatDate(parsed.start, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');
      reply(evt.replyToken, '✅ บันทึกนัดแล้ว!\n📌 ' + parsed.title + '\n🗓 ' + ds + ' น.');
    } else {
      const aiReply = callOpenAI(text);
      reply(evt.replyToken, aiReply);
    }
    return ok();
  } catch(err) { return ok(); }
}

// ─────────────────────────────────────────────
function parseAppointmentWithAI(text) {
  const today = new Date();
  const dateStr = Utilities.formatDate(today, 'Asia/Bangkok', 'yyyy-MM-dd');
  const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
  const prompt = 'วันนี้คือ ' + dateStr + ' วัน' + days[today.getDay()] + ' ผู้ใช้ส่งข้อความ: "' + text + '"\nวิเคราะห์ว่าเป็นการบันทึกนัดหมายมั้ย ตอบ JSON อย่างเดียว:\nถ้าเป็นนัด: {"isAppt":true,"date":"YYYY-MM-DD","hour":13,"minute":30,"title":"ชื่อนัด"}\nถ้าไม่ใช่: {"isAppt":false}\nกฎ: "เสาร์หน้า"=วันเสาร์ถัดไปนับจากวันนี้ / "ครึ่ง"=30นาที / "บ่ายโมงครึ่ง"={"hour":13,"minute":30} / คำนวณวันที่ให้แม่นยำ';
  const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
    payload: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 100, temperature: 0 }),
    muteHttpExceptions: true
  });
  try {
    let content = JSON.parse(res.getContentText()).choices[0].message.content.trim();
    content = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const parsed = JSON.parse(content);
    if (!parsed.isAppt || !parsed.date || parsed.hour === undefined || !parsed.title) return null;
    const [y, mo, d] = parsed.date.split('-').map(Number);
    const start = new Date(y, mo - 1, d, parsed.hour, parsed.minute || 0, 0);
    const end   = new Date(y, mo - 1, d, parsed.hour + 1, parsed.minute || 0, 0);
    return { title: parsed.title, start, end };
  } catch(e) { return null; }
}

// ─────────────────────────────────────────────
function handleCancel(text, replyToken) {
  const today = new Date();
  const dateStr = Utilities.formatDate(today, 'Asia/Bangkok', 'yyyy-MM-dd');
  const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
  const prompt = 'วันนี้คือ ' + dateStr + ' วัน' + days[today.getDay()] + '\nข้อความ: "' + text + '"\nวิเคราะห์คำสั่งยกเลิกนัด ตอบ JSON อย่างเดียว:\n{"date":"YYYY-MM-DD","keyword":"ชื่อนัด หรือ empty string ถ้าไม่ระบุ"}\nกฎ: "พรุ่งนี้"=วันถัดไป / "วันเสาร์"=เสาร์ถัดไป / "วันนี้"=วันนี้ / ถ้าไม่บอกวันให้ใช้วันนี้';
  try {
    const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
      payload: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 80, temperature: 0 }),
      muteHttpExceptions: true
    });
    let content = JSON.parse(res.getContentText()).choices[0].message.content.trim();
    content = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const parsed = JSON.parse(content);
    if (!parsed.date) { reply(replyToken, '❓ ระบุวันที่ด้วยนะ เช่น "ยกเลิกนัดพรุ่งนี้"'); return; }
    const [y, mo, d] = parsed.date.split('-').map(Number);
    const start = new Date(y, mo - 1, d, 0, 0, 0);
    const end   = new Date(y, mo - 1, d, 23, 59, 59);
    const events = CalendarApp.getCalendarById(CALENDAR_ID).getEvents(start, end);
    const keyword = (parsed.keyword || '').trim().toLowerCase();
    const matched = keyword ? events.filter(e => e.getTitle().toLowerCase().includes(keyword)) : events;
    if (matched.length === 0) { reply(replyToken, '❌ ไม่พบนัดในวันที่ระบุ'); return; }
    matched.forEach(e => e.deleteEvent());
    reply(replyToken, '🗑 ยกเลิกนัดแล้ว!\n' + matched.map(e => '📌 ' + e.getTitle()).join('\n'));
  } catch(e) { reply(replyToken, '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'); }
}

// ─────────────────────────────────────────────
function handleViewEvents(text, replyToken) {
  const today = new Date();
  const dateStr = Utilities.formatDate(today, 'Asia/Bangkok', 'yyyy-MM-dd');
  const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
  const prompt = 'วันนี้คือ ' + dateStr + ' วัน' + days[today.getDay()] + '\nข้อความ: "' + text + '"\nระบุช่วงวันที่ที่ต้องการดูนัด ตอบ JSON อย่างเดียว:\n{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}\nกฎ: "พรุ่งนี้"=วันถัดไป / "สัปดาห์นี้"=จันทร์ถึงอาทิตย์ของสัปดาห์นี้ / "สัปดาห์หน้า"=สัปดาห์ถัดไป / "เดือนนี้"=ต้นเดือนถึงสิ้นเดือน / ถ้าไม่ระบุ=วันนี้';
  try {
    const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
      payload: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 80, temperature: 0 }),
      muteHttpExceptions: true
    });
    let content = JSON.parse(res.getContentText()).choices[0].message.content.trim();
    content = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const parsed = JSON.parse(content);
    const [sy, sm, sd] = parsed.startDate.split('-').map(Number);
    const [ey, em, ed] = parsed.endDate.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd, 0, 0, 0);
    const end   = new Date(ey, em - 1, ed, 23, 59, 59);
    const events = CalendarApp.getCalendarById(CALENDAR_ID).getEvents(start, end);
    if (events.length === 0) { reply(replyToken, '📭 ไม่มีนัดในช่วงที่ระบุ'); return; }
    const label = parsed.startDate === parsed.endDate
      ? Utilities.formatDate(start, 'Asia/Bangkok', 'dd/MM/yyyy')
      : Utilities.formatDate(start, 'Asia/Bangkok', 'dd/MM') + ' — ' + Utilities.formatDate(end, 'Asia/Bangkok', 'dd/MM/yyyy');
    const list = events.map(e =>
      '📌 ' + Utilities.formatDate(e.getStartTime(), 'Asia/Bangkok', 'dd/MM HH:mm') + ' — ' + e.getTitle()
    ).join('\n');
    reply(replyToken, '📅 นัด ' + label + '\n\n' + list);
  } catch(e) { reply(replyToken, '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'); }
}

// ─────────────────────────────────────────────
function handleEditEvent(text, replyToken) {
  const today = new Date();
  const dateStr = Utilities.formatDate(today, 'Asia/Bangkok', 'yyyy-MM-dd');
  const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
  const prompt = 'วันนี้คือ ' + dateStr + ' วัน' + days[today.getDay()] + '\nข้อความ: "' + text + '"\nวิเคราะห์คำสั่งแก้ไขนัด ตอบ JSON อย่างเดียว:\n{"searchDate":"YYYY-MM-DD","keyword":"ชื่อนัดเดิม หรือ empty string","newDate":"YYYY-MM-DD หรือ null","newHour":null,"newMinute":null,"newTitle":null}\nnewHour/newMinute/newTitle ให้เป็น null ถ้าไม่เปลี่ยน';
  try {
    const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
      payload: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 150, temperature: 0 }),
      muteHttpExceptions: true
    });
    let content = JSON.parse(res.getContentText()).choices[0].message.content.trim();
    content = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const p = JSON.parse(content);
    const [sy, sm, sd] = p.searchDate.split('-').map(Number);
    const searchStart = new Date(sy, sm - 1, sd, 0, 0, 0);
    const searchEnd   = new Date(sy, sm - 1, sd, 23, 59, 59);
    const events = CalendarApp.getCalendarById(CALENDAR_ID).getEvents(searchStart, searchEnd);
    const keyword = (p.keyword || '').trim().toLowerCase();
    const matched = keyword ? events.filter(e => e.getTitle().toLowerCase().includes(keyword)) : events;
    if (matched.length === 0) { reply(replyToken, '❌ ไม่พบนัดที่ระบุ'); return; }
    const evt = matched[0];
    const oldStart = evt.getStartTime();
    const newTitle = p.newTitle || evt.getTitle();
    let newStart, newEnd;
    if (p.newDate) {
      const [ny, nm, nd] = p.newDate.split('-').map(Number);
      const h = p.newHour !== null ? p.newHour : oldStart.getHours();
      const m = p.newMinute !== null ? p.newMinute : oldStart.getMinutes();
      newStart = new Date(ny, nm - 1, nd, h, m, 0);
      newEnd   = new Date(ny, nm - 1, nd, h + 1, m, 0);
    } else if (p.newHour !== null) {
      newStart = new Date(oldStart.getFullYear(), oldStart.getMonth(), oldStart.getDate(), p.newHour, p.newMinute || 0, 0);
      newEnd   = new Date(oldStart.getFullYear(), oldStart.getMonth(), oldStart.getDate(), p.newHour + 1, p.newMinute || 0, 0);
    } else {
      newStart = oldStart;
      newEnd   = evt.getEndTime();
    }
    evt.deleteEvent();
    CalendarApp.getCalendarById(CALENDAR_ID).createEvent(newTitle, newStart, newEnd);
    const ds = Utilities.formatDate(newStart, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');
    reply(replyToken, '✏️ แก้ไขนัดแล้ว!\n📌 ' + newTitle + '\n🗓 ' + ds + ' น.');
  } catch(e) { reply(replyToken, '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'); }
}

// ─────────────────────────────────────────────
function morningBriefing() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
  const end   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
  const events = CalendarApp.getCalendarById(CALENDAR_ID).getEvents(start, end);
  const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
  const ds = Utilities.formatDate(today, 'Asia/Bangkok', 'dd/MM/yyyy');
  let msg;
  if (events.length === 0) {
    msg = '🌅 อรุณสวัสดิ์! วัน' + days[today.getDay()] + 'ที่ ' + ds + '\n\n📭 วันนี้ไม่มีนัดหมาย';
  } else {
    const list = events.map(e => '  🕐 ' + Utilities.formatDate(e.getStartTime(), 'Asia/Bangkok', 'HH:mm') + ' — ' + e.getTitle()).join('\n');
    msg = '🌅 อรุณสวัสดิ์! วัน' + days[today.getDay()] + 'ที่ ' + ds + '\n\n📅 นัดวันนี้ ' + events.length + ' รายการ:\n' + list;
  }
  push(msg);
}

// ─────────────────────────────────────────────
function checkReminders() {
  const now = new Date();
  const props = PropertiesService.getScriptProperties();
  const notified = JSON.parse(props.getProperty('NOTIFIED') || '{}');
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  cal.getEvents(new Date(now.getTime() + 4 * 60000), new Date(now.getTime() + 6 * 60000)).forEach(e => {
    const key = e.getId() + '_5';
    if (!notified[key]) {
      push('⏰ อีก 5 นาที!\n📌 ' + e.getTitle() + '\n🕐 ' + Utilities.formatDate(e.getStartTime(), 'Asia/Bangkok', 'HH:mm') + ' น.');
      notified[key] = now.getTime();
    }
  });
  cal.getEvents(new Date(now.getTime() - 60000), new Date(now.getTime() + 60000)).forEach(e => {
    const key = e.getId() + '_now';
    if (!notified[key]) {
      push('🔔 ถึงเวลาแล้ว!\n📌 ' + e.getTitle() + '\n🕐 ' + Utilities.formatDate(e.getStartTime(), 'Asia/Bangkok', 'HH:mm') + ' น.');
      notified[key] = now.getTime();
    }
  });
  const cutoff = now.getTime() - 86400000;
  Object.keys(notified).forEach(k => { if (notified[k] < cutoff) delete notified[k]; });
  props.setProperty('NOTIFIED', JSON.stringify(notified));
}

// ─────────────────────────────────────────────
function getTodayEvents() {
  try {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const end   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    const events = CalendarApp.getCalendarById(CALENDAR_ID).getEvents(start, end);
    if (events.length === 0) return 'วันนี้ไม่มีนัดหมาย';
    return 'นัดวันนี้ ' + events.length + ' รายการ: ' + events.map(e =>
      Utilities.formatDate(e.getStartTime(), 'Asia/Bangkok', 'HH:mm') + ' — ' + e.getTitle()
    ).join(' | ');
  } catch(e) { return ''; }
}

// ─────────────────────────────────────────────
function callOpenAI(userMessage) {
  const props = PropertiesService.getScriptProperties();
  let history = JSON.parse(props.getProperty('CHAT_HISTORY') || '[]');
  const profile = JSON.parse(props.getProperty('USER_PROFILE') || '{}');

  const botName = profile['ชื่อบอท'] || 'เลขา';
  let profileNote = '';
  if (Object.keys(profile).length > 0) profileNote = '\n\nสิ่งที่จำเกี่ยวกับเจ้านาย: ' + JSON.stringify(profile);

  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'Asia/Bangkok', 'dd/MM/yyyy');
  const timeStr = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm');
  const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
  const bangkokDow = parseInt(Utilities.formatDate(now, 'Asia/Bangkok', 'u')) % 7;

  const systemPrompt = 'คุณคือเลขาส่วนตัวชื่อ "' + botName + '" จำสิ่งที่เจ้านายบอก ช่วยตอบคำถามทั่วไป และพูดคุยอย่างเป็นมิตรเหมือนเลขาจริงๆ ตอบเป็นภาษาไทย กระชับไม่เกิน 4 ประโยค ห้ามแกล้งทำเป็นว่าบันทึกนัดหรือยกเลิกนัดแทนระบบ ตอนนี้คือวัน' + days[bangkokDow] + 'ที่ ' + dateStr + ' เวลา ' + timeStr + ' น.' + profileNote + '\n\n' + getTodayEvents();

  const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userMessage }];
  const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
    payload: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 500 }),
    muteHttpExceptions: true
  });
  const aiReply = JSON.parse(res.getContentText()).choices[0].message.content;

  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content: aiReply });
  if (history.length > 20) history = history.slice(-20);
  props.setProperty('CHAT_HISTORY', JSON.stringify(history));

  saveProfileIfMentioned(userMessage, aiReply, props);
  return aiReply;
}

// ─────────────────────────────────────────────
function saveProfileIfMentioned(userMessage, aiReply, props) {
  const profile = JSON.parse(props.getProperty('USER_PROFILE') || '{}');
  const prompt = 'บทสนทนา:\nเจ้านาย: "' + userMessage + '"\nเลขา: "' + aiReply + '"\n\nมีข้อมูลสำคัญที่ควรจำมั้ย? ตอบ JSON อย่างเดียว:\nถ้ามี: {"hasInfo":true,"key":"ชื่อเจ้านาย","value":"เรยา"}\nถ้าไม่มี: {"hasInfo":false}\nkey ที่รองรับ: ชื่อเจ้านาย, ชื่อบอท, ส่วนสูง, น้ำหนัก, อาชีพ, วันเกิด';
  try {
    const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
      payload: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 80, temperature: 0 }),
      muteHttpExceptions: true
    });
    let content = JSON.parse(res.getContentText()).choices[0].message.content.trim();
    content = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const result = JSON.parse(content);
    if (result.hasInfo && result.key && result.value) {
      profile[result.key] = result.value;
      props.setProperty('USER_PROFILE', JSON.stringify(profile));
    }
  } catch(e) {}
}

// ─────────────────────────────────────────────
function push(msg) {
  const props = PropertiesService.getScriptProperties();
  const userId = props.getProperty('USER_ID');
  if (!userId) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify({ to: userId, messages: [{ type: 'text', text: msg }] }),
    muteHttpExceptions: true
  });
}

function reply(replyToken, msg) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + LINE_TOKEN },
    payload: JSON.stringify({ replyToken, messages: [{ type: 'text', text: msg }] }),
    muteHttpExceptions: true
  });
}

function ok() {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('morningBriefing').timeBased().atHour(6).everyDays(1).inTimezone('Asia/Bangkok').create();
  ScriptApp.newTrigger('checkReminders').timeBased().everyMinutes(5).create();
  return '✅ Triggers ready';
}
