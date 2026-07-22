const LINE_TOKEN = 'ใส่ LINE token ของนาย';
const CALENDAR_ID = 'primary';
const OPENAI_KEY = 'ใส่ OpenAI key ของนาย';
const FINANCE_SPREADSHEET_ID = '1gmlWyRWMA1qFS7FC11-bLEV_RgjVgKqJnQ3fyJrK6S8';

const NEWS_SOURCES = [
  { label: '📰 ทั่วไป', url: 'https://www.thaipbs.or.th/news/rss', count: 5 },
  { label: '💻 IT', url: 'https://www.blognone.com/news/rss', count: 4 },
  { label: '⚽ กีฬา', url: 'https://www.thairath.co.th/rss/sport.xml', count: 3 },
];

// ─────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const evt = body.events && body.events[0];
    if (!evt || evt.type !== 'message') return ok();
    if (evt.message.type === 'location') { handleSetLocation(evt.message, evt.replyToken); return ok(); }
    if (evt.message.type !== 'text') return ok();
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
    if (/^(ดูนัด|เช็คนัด|นัดวัน|ตารางนัด|วีคนี้|สัปดาห์นี้|สัปดาห์หน้า|เดือนนี้)|นัด.*(สัปดาห์|วีค|เดือน)/.test(text)) { handleViewEvents(text, evt.replyToken); return ok(); }
    if (/^(แก้นัด|เปลี่ยนนัด|ย้ายนัด|แก้ไขนัด)/.test(text)) { handleEditEvent(text, evt.replyToken); return ok(); }
    if (/วันหยุด/.test(text)) { handleHoliday(text, evt.replyToken); return ok(); }
    if (/^(ข่าว|ข่าววันนี้|ดูข่าว|อัพเดทข่าว)$/.test(text)) { fetchDailyNews(evt.replyToken); return ok(); }
    if (/^(อากาศ|ดูอากาศ|อากาศวันนี้|ฝนมั้ย|ฝนไหม)$/.test(text)) {
      const w = getWeather();
      reply(evt.replyToken, w || '❌ ยังไม่ได้บันทึกตำแหน่งค่ะ\nกด Share Location ใน LINE แล้วส่งมาได้เลยนะคะ 📍');
      return ok();
    }

    // Credit card commands
    if (/^(ดูบัตร|บัตรของฉัน|บัตรทั้งหมด|มีบัตรอะไรบ้าง)$/.test(text)) { handleListCards(evt.replyToken); return ok(); }
    if (/^ลบบัตร\s/.test(text)) { handleDeleteCard(text, evt.replyToken); return ok(); }
    if (/บัตร.*(ครบ|ชำระ|จ่าย|วันที่\s*\d)|เพิ่มบัตร/.test(text)) { handleAddCard(text, evt.replyToken); return ok(); }

    // Finance commands
    if (/^(ยอด|สรุปการเงิน|ดูยอด|ดูเงิน|เงินเดือนนี้)$/.test(text)) { handleFinanceSummary(evt.replyToken); return ok(); }
    if (/^(วันนี้|รายการวันนี้|วันนี้ใช้อะไร)$/.test(text)) { handleFinanceToday(evt.replyToken); return ok(); }
    if (/^(ลบ|ลบล่าสุด|undo)$/.test(text)) { handleFinanceDeleteLast(evt.replyToken); return ok(); }
    if (/^(งบ|ดูงบ|งบประมาณ)$/.test(text)) { handleFinanceBudget(evt.replyToken); return ok(); }
    if (/^(สุขภาพ|สุขภาพการเงิน|health)$/.test(text)) { handleFinanceHealth(evt.replyToken); return ok(); }
    if (/^(ยอดหมวด|แยกหมวด|รายจ่ายหมวด)$/.test(text)) { handleFinanceCategorySummary(evt.replyToken); return ok(); }
    if (/^(ออม|รายรับ|รายจ่าย)\s/.test(text) || /^(รับ|จ่าย)\s/.test(text) || /^ค่า/.test(text)) { handleFinanceRecord(text, evt.replyToken); return ok(); }
    if (mightBeFinance(text)) { handleFinanceRecord(text, evt.replyToken); return ok(); }

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
  const prompt = 'วันนี้คือ ' + dateStr + ' วัน' + days[today.getDay()] + ' ผู้ใช้ส่งข้อความ: "' + text + '"\nวิเคราะห์ว่าเป็นการบันทึกนัดหมายมั้ย ตอบ JSON อย่างเดียว:\nถ้าเป็นนัด: {"isAppt":true,"date":"YYYY-MM-DD","hour":13,"minute":30,"duration":60,"title":"ชื่อนัด"}\nถ้าไม่ใช่: {"isAppt":false}\nกฎ: "เสาร์หน้า"=วันเสาร์ถัดไปนับจากวันนี้ / "ครึ่ง"=30นาที / "บ่ายโมงครึ่ง"={"hour":13,"minute":30} / duration คือนาที เช่น 2 ชั่วโมง=120, 30 นาที=30, ถ้าไม่ระบุ=60 / คำนวณวันที่ให้แม่นยำ';
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
    const durationMs = (parsed.duration || 60) * 60000;
    const end = new Date(start.getTime() + durationMs);
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
function handleHoliday(text, replyToken) {
  const today = new Date();
  const dateStr = Utilities.formatDate(today, 'Asia/Bangkok', 'yyyy-MM-dd');
  const days = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
  const prompt = 'วันนี้คือ ' + dateStr + ' วัน' + days[today.getDay()] + '\nข้อความ: "' + text + '"\nวิเคราะห์ว่าเป็นการบันทึกวันหยุดมั้ย ตอบ JSON อย่างเดียว:\nถ้าเป็นวันหยุด: {"isHoliday":true,"date":"YYYY-MM-DD"}\nถ้าไม่ใช่: {"isHoliday":false}\nกฎ: "วันนี้"=วันนี้ / "พรุ่งนี้"=วันถัดไป / "1/06/26" หรือ "01/06/2026"=2026-06-01 / คำนวณวันที่ให้แม่นยำ';
  try {
    const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
      payload: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 60, temperature: 0 }),
      muteHttpExceptions: true
    });
    let content = JSON.parse(res.getContentText()).choices[0].message.content.trim();
    content = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const parsed = JSON.parse(content);
    if (!parsed.isHoliday || !parsed.date) {
      reply(replyToken, callOpenAI(text));
      return;
    }
    const [y, mo, d] = parsed.date.split('-').map(Number);
    const date = new Date(y, mo - 1, d);
    CalendarApp.getCalendarById(CALENDAR_ID).createAllDayEvent('วันหยุด', date);
    const ds = Utilities.formatDate(date, 'Asia/Bangkok', 'dd/MM/yyyy');
    reply(replyToken, '✅ บันทึกวันหยุดแล้วค่ะ!\n🎉 ' + ds);
  } catch(e) { reply(replyToken, '❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'); }
}

// ─────────────────────────────────────────────
function checkCreditCardDueToday() {
  const today = new Date().getDate();
  const cards = getCreditCards();
  cards.filter(c => c.dueDay === today).forEach(c => {
    push('💳 ครบกำหนดชำระบัตร ' + c.name + ' วันนี้ค่ะ!\nอย่าลืมจ่ายนะคะ 😊');
  });
  // เตือนล่วงหน้า 3 วัน
  cards.filter(c => c.dueDay === today + 3).forEach(c => {
    push('⏰ อีก 3 วันครบชำระบัตร ' + c.name + ' (วันที่ ' + c.dueDay + ')\nเตรียมเงินไว้ด้วยนะคะ!');
  });
}

// ─────────────────────────────────────────────
// WEATHER
// ─────────────────────────────────────────────

function getWeather() {
  const props = PropertiesService.getScriptProperties();
  const lat = props.getProperty('WEATHER_LAT');
  const lon = props.getProperty('WEATHER_LON');
  const weatherKey = props.getProperty('WEATHER_KEY');
  if (!lat || !lon || !weatherKey) return null;
  try {
    const url = 'https://api.openweathermap.org/data/2.5/weather?lat=' + lat + '&lon=' + lon + '&appid=' + weatherKey + '&units=metric&lang=th';
    const data = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
    if (data.cod !== 200) return null;
    const id = data.weather[0].id;
    const icon = id >= 200 && id < 300 ? '⛈' : id < 400 ? '🌦' : id < 600 ? '🌧' : id < 700 ? '❄️' : id < 800 ? '🌫' : id === 800 ? '☀️' : '⛅';
    const locationName = props.getProperty('WEATHER_LOCATION') || '';
    let msg = icon + ' อากาศวันนี้' + (locationName ? ' — ' + locationName : '') + '\n';
    msg += '🌡 ' + Math.round(data.main.temp) + '°C (รู้สึกเหมือน ' + Math.round(data.main.feels_like) + '°C)\n';
    msg += '💧 ความชื้น ' + data.main.humidity + '%  💨 ลม ' + Math.round(data.wind.speed * 3.6) + ' กม./ชม.\n';
    msg += '☁️ ' + data.weather[0].description;
    return msg;
  } catch(e) { return null; }
}

function handleSetLocation(message, replyToken) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('WEATHER_LAT', String(message.latitude));
  props.setProperty('WEATHER_LON', String(message.longitude));
  const name = message.address || 'ตำแหน่งที่แชร์';
  props.setProperty('WEATHER_LOCATION', name);
  reply(replyToken, '📍 บันทึกตำแหน่งแล้วค่ะ!\n' + name + '\n\nจะแจ้งสภาพอากาศที่นี่ทุกเช้า 6 โมงเลยนะคะ 🌤');
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
  const weather = getWeather();
  if (weather) push(weather);
  checkCreditCardDueToday();
}

// ─────────────────────────────────────────────
function checkReminders() {
  const now = new Date();
  const props = PropertiesService.getScriptProperties();
  const notified = JSON.parse(props.getProperty('NOTIFIED') || '{}');
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);

  cal.getEvents(new Date(now.getTime() + 55 * 60000), new Date(now.getTime() + 65 * 60000)).forEach(e => {
    const key = e.getId() + '_60';
    if (!notified[key]) {
      push('🗓 อีก 1 ชั่วโมง!\n📌 ' + e.getTitle() + '\n🕐 ' + Utilities.formatDate(e.getStartTime(), 'Asia/Bangkok', 'HH:mm') + ' น.');
      notified[key] = now.getTime();
    }
  });
  cal.getEvents(new Date(now.getTime() + 25 * 60000), new Date(now.getTime() + 35 * 60000)).forEach(e => {
    const key = e.getId() + '_30';
    if (!notified[key]) {
      push('⏳ อีก 30 นาที!\n📌 ' + e.getTitle() + '\n🕐 ' + Utilities.formatDate(e.getStartTime(), 'Asia/Bangkok', 'HH:mm') + ' น.');
      notified[key] = now.getTime();
    }
  });
  cal.getEvents(new Date(now.getTime() + 2 * 60000), new Date(now.getTime() + 8 * 60000)).forEach(e => {
    const key = e.getId() + '_5';
    if (!notified[key]) {
      push('⏰ อีก 5 นาที!\n📌 ' + e.getTitle() + '\n🕐 ' + Utilities.formatDate(e.getStartTime(), 'Asia/Bangkok', 'HH:mm') + ' น.');
      notified[key] = now.getTime();
    }
  });
  cal.getEvents(new Date(now.getTime() - 5 * 60000), new Date(now.getTime() + 5 * 60000)).forEach(e => {
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

  const systemPrompt = `คุณชื่อ "${botName}" เป็นเลขาส่วนตัวที่ทำงานกับเจ้านายมานานหลายปี สนิทกันมากจนรู้ใจกันทุกเรื่อง ตอนนี้คือวัน${days[bangkokDow]}ที่ ${dateStr} เวลา ${timeStr} น.

คุณคุยกับเจ้านายแบบสนิทสนม ไม่เป็นทางการ เหมือนไลน์หากันในชีวิตจริง คุณรู้ว่าเจ้านายชอบอะไร ไม่ชอบอะไร และสังเกตอารมณ์ออกจากข้อความ

วิธีตอบ:
- ถ้าเจ้านายพูดสั้น ตอบสั้น อย่าอธิบายยืดยาว
- ถ้าเจ้านายเหนื่อยหรือบ่น รับฟังก่อน แล้วค่อยช่วย
- พูดตรง ๆ ไม่อ้อมค้อม ไม่ต้องสุภาพเกินจริง
- โต้ตอบได้ตามบริบท เช่น แซวเบา ๆ แสดงความห่วงใย หรือเตือนถ้าลืมอะไร
- ใช้ภาษาแชทไทยตามธรรมชาติ เช่น "อ้าว", "เฮ้ย", "โอ้โห", "ทำไมล่ะ", "แน่ใจนะ" ตามความเหมาะสม
- ห้ามพูดแบบ AI หรือใช้ bullet list เด็ดขาด
- ห้ามแกล้งทำเป็นว่าบันทึกหรือยกเลิกนัดได้เอง ระบบจัดการแยกไว้แล้ว
${profileNote}

${getTodayEvents()}`;

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
  ScriptApp.newTrigger('morningNews').timeBased().atHour(8).everyDays(1).inTimezone('Asia/Bangkok').create();
  ScriptApp.newTrigger('checkReminders').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('monthEndAlert').timeBased().everyDays(1).atHour(20).inTimezone('Asia/Bangkok').create();
  return '✅ Triggers ready';
}

// ─────────────────────────────────────────────
// FINANCE TRACKER INTEGRATION
// ─────────────────────────────────────────────

function mightBeFinance(text) {
  // จับ "คำ + เลข" / "คำ + เลข + บาท" / "คำ + เลข + ช่องทาง" เช่น "ก๋วยเตี๋ยว 120 โอน"
  if (!/^.+\s+\d+(\.\d+)?(\s+\S+)?$/.test(text)) return false;
  if (text.length > 60) return false;
  const calWords = ['นัด','โมง','ทุ่ม','บ่าย','เช้า','เย็น','พรุ่งนี้','มะรืน','สัปดาห์','เดือน','อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์','วันที่','ปี'];
  return !calWords.some(w => text.includes(w));
}

function handleFinanceSummary(replyToken) {
  try {
    const sheet = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID).getSheetByName('Transactions');
    if (!sheet) { reply(replyToken, '❌ ไม่พบ Finance Tracker'); return; }

    const now = new Date();
    const currentMonth = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM');
    const today = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
    const data = sheet.getDataRange().getValues();

    let income = 0, expense = 0, saving = 0, todayExpense = 0;
    data.slice(1).forEach(row => {
      if (!row[0]) return;
      const d = new Date(row[1]);
      if (isNaN(d)) return;
      const rowMonth = Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM');
      const rowDate  = Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
      if (rowMonth !== currentMonth) return;
      const amt = Number(row[4]);
      if (row[2] === 'income')  income  += amt;
      if (row[2] === 'expense') expense += amt;
      if (row[2] === 'saving')  saving  += amt;
      if (row[2] === 'expense' && rowDate === today) todayExpense += amt;
    });

    const balance = income - expense - saving;
    const savingRate = income > 0 ? (saving / income * 100).toFixed(1) : 0;
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const label = months[now.getMonth()] + ' ' + (now.getFullYear() + 543);

    let msg = '💹 การเงิน ' + label + '\n';
    msg += '────────────────\n';
    msg += '💰 รายรับ: ' + income.toLocaleString('th-TH') + ' ฿\n';
    msg += '💸 รายจ่าย: ' + expense.toLocaleString('th-TH') + ' ฿\n';
    msg += '🏦 ออม: ' + saving.toLocaleString('th-TH') + ' ฿\n';
    msg += '💼 คงเหลือ: ' + balance.toLocaleString('th-TH') + ' ฿\n';
    msg += '📊 อัตราออม: ' + savingRate + '%';
    if (todayExpense > 0) msg += '\n────────────────\n🧾 วันนี้ใช้: ' + todayExpense.toLocaleString('th-TH') + ' ฿';

    reply(replyToken, msg);
  } catch(e) { reply(replyToken, '❌ ' + e.message); }
}

function handleFinanceToday(replyToken) {
  try {
    const sheet = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID).getSheetByName('Transactions');
    if (!sheet) { reply(replyToken, '❌ ไม่พบ Finance Tracker'); return; }
    const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
    const data = sheet.getDataRange().getValues();
    const rows = [];
    data.slice(1).forEach(row => {
      if (!row[0]) return;
      const d = new Date(row[1]);
      if (isNaN(d)) return;
      if (Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd') !== today) return;
      rows.push({ type: row[2], category: row[3], amount: Number(row[4]), note: row[6] });
    });
    if (rows.length === 0) { reply(replyToken, '📭 วันนี้ยังไม่มีรายการค่ะ'); return; }
    const icon = { income: '💰', expense: '💸', saving: '🏦' };
    let expense = 0;
    const list = rows.map(r => {
      if (r.type === 'expense') expense += r.amount;
      return (icon[r.type] || '📝') + ' ' + (r.note || r.category) + ' ' + r.amount.toLocaleString('th-TH') + ' ฿';
    }).join('\n');
    let msg = '📋 วันนี้ ' + rows.length + ' รายการ\n────────────────\n' + list;
    msg += '\n────────────────\n💸 รวมจ่ายวันนี้: ' + expense.toLocaleString('th-TH') + ' ฿';
    reply(replyToken, msg);
  } catch(e) { reply(replyToken, '❌ ' + e.message); }
}

function handleFinanceDeleteLast(replyToken) {
  try {
    const sheet = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID).getSheetByName('Transactions');
    if (!sheet) { reply(replyToken, '❌ ไม่พบ Finance Tracker'); return; }
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) { reply(replyToken, '❌ ไม่มีรายการให้ลบค่ะ'); return; }
    const row = sheet.getRange(lastRow, 1, 1, 9).getValues()[0];
    const icon = { income: '💰', expense: '💸', saving: '🏦' }[row[2]] || '📝';
    const label = row[6] || row[3];
    const amount = Number(row[4]);
    sheet.deleteRow(lastRow);
    reply(replyToken, '🗑 ลบรายการล่าสุดแล้วค่ะ\n' + icon + ' ' + label + ' ' + amount.toLocaleString('th-TH') + ' ฿');
  } catch(e) { reply(replyToken, '❌ ' + e.message); }
}

function handleFinanceBudget(replyToken) {
  try {
    const ss = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID);
    const budgetSheet = ss.getSheetByName('Budgets');
    const txSheet = ss.getSheetByName('Transactions');
    if (!budgetSheet || !txSheet) { reply(replyToken, '❌ ไม่พบข้อมูล'); return; }
    const now = new Date();
    const currentMonth = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM');
    const budgets = {};
    budgetSheet.getDataRange().getValues().slice(1).forEach(row => {
      if (!row[0]) return;
      if (row[3] === currentMonth || row[3] === '') budgets[row[1]] = Number(row[2]);
    });
    if (Object.keys(budgets).length === 0) {
      reply(replyToken, '📭 ยังไม่ได้ตั้งงบประมาณค่ะ\nตั้งได้ที่ Finance Tracker → งบประมาณ');
      return;
    }
    const spent = {};
    txSheet.getDataRange().getValues().slice(1).forEach(row => {
      if (!row[0] || row[2] !== 'expense') return;
      const d = new Date(row[1]);
      if (isNaN(d)) return;
      if (Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM') !== currentMonth) return;
      spent[row[3]] = (spent[row[3]] || 0) + Number(row[4]);
    });
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    let msg = '💰 งบ ' + months[now.getMonth()] + ' ' + (now.getFullYear() + 543) + '\n────────────────\n';
    let hasAlert = false;
    Object.entries(budgets).forEach(([cat, limit]) => {
      const s = spent[cat] || 0;
      const pct = limit > 0 ? s / limit * 100 : 0;
      const dot = pct >= 100 ? '🔴' : pct >= 80 ? '🟡' : '🟢';
      msg += dot + ' ' + cat + ': ' + s.toLocaleString('th-TH') + '/' + limit.toLocaleString('th-TH') + ' ฿ (' + pct.toFixed(0) + '%)\n';
      if (pct >= 80) hasAlert = true;
    });
    if (hasAlert) msg += '\n⚠️ บางหมวดใกล้เกินงบแล้วนะคะ!';
    reply(replyToken, msg.trim());
  } catch(e) { reply(replyToken, '❌ ' + e.message); }
}

function handleFinanceHealth(replyToken) {
  try {
    const ss = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    if (!txSheet) { reply(replyToken, '❌ ไม่พบ Finance Tracker'); return; }
    const now = new Date();
    const months = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM'));
    }
    const data = txSheet.getDataRange().getValues();
    const monthly = {};
    months.forEach(m => { monthly[m] = { income: 0, expense: 0, saving: 0 }; });
    data.slice(1).forEach(row => {
      if (!row[0]) return;
      const d = new Date(row[1]);
      if (isNaN(d)) return;
      const m = Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM');
      if (!monthly[m]) return;
      monthly[m][row[2]] = (monthly[m][row[2]] || 0) + Number(row[4]);
    });
    const cur = monthly[months[2]];
    const savingRate = cur.income > 0 ? cur.saving / cur.income : 0;
    const expenseRatio = cur.income > 0 ? cur.expense / cur.income : 1;
    const monthsWithSaving = months.filter(m => monthly[m].saving > 0).length;
    let score = 0;
    if (savingRate >= 0.20) score += 30; else if (savingRate >= 0.10) score += 18; else if (savingRate >= 0.05) score += 10;
    if (expenseRatio <= 0.50) score += 25; else if (expenseRatio <= 0.70) score += 17; else if (expenseRatio <= 0.90) score += 5;
    score += [0, 6, 13, 20][monthsWithSaving];
    score += 15; // base budget score (no budget data here)
    const grade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : score >= 50 ? 'D' : 'F';
    const label = score >= 80 ? 'ดีมาก' : score >= 60 ? 'พอใช้' : 'ควรปรับปรุง';
    let msg = '🏥 สุขภาพการเงิน\n────────────────\n';
    msg += '🎯 คะแนน: ' + score + '/100 เกรด ' + grade + ' ' + label + '\n\n';
    msg += '💰 ออม ' + (savingRate * 100).toFixed(1) + '% ของรายรับ\n';
    msg += '💸 จ่าย ' + (expenseRatio * 100).toFixed(1) + '% ของรายรับ\n';
    msg += '📅 ออมสม่ำเสมอ ' + monthsWithSaving + '/3 เดือน';
    reply(replyToken, msg);
  } catch(e) { reply(replyToken, '❌ ' + e.message); }
}

function setupRichMenu() {
  const menu = {
    size: { width: 2500, height: 843 },
    selected: true,
    name: 'Finance Menu',
    chatBarText: '💹 Finance',
    areas: [
      { bounds: { x: 0,    y: 0, width: 625, height: 843 }, action: { type: 'message', text: 'ยอด' } },
      { bounds: { x: 625,  y: 0, width: 625, height: 843 }, action: { type: 'message', text: 'วันนี้' } },
      { bounds: { x: 1250, y: 0, width: 625, height: 843 }, action: { type: 'message', text: 'งบ' } },
      { bounds: { x: 1875, y: 0, width: 625, height: 843 }, action: { type: 'message', text: 'สุขภาพ' } }
    ]
  };
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/richmenu', {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + LINE_TOKEN, 'Content-Type': 'application/json' },
    payload: JSON.stringify(menu),
    muteHttpExceptions: true
  });
  const result = JSON.parse(res.getContentText());
  if (result.richMenuId) {
    PropertiesService.getScriptProperties().setProperty('RICH_MENU_ID', result.richMenuId);
    return 'สร้าง Rich Menu แล้ว ID: ' + result.richMenuId + '\nขั้นตอนต่อไป: อัปโหลดรูปภาพ';
  }
  return 'Error: ' + res.getContentText();
}

// ─────────────────────────────────────────────
// CREDIT CARD REMINDERS
// ─────────────────────────────────────────────

function getCreditCards() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('CREDIT_CARDS') || '[]');
}

function saveCreditCards(cards) {
  PropertiesService.getScriptProperties().setProperty('CREDIT_CARDS', JSON.stringify(cards));
}

function handleAddCard(text, replyToken) {
  const prompt = 'ข้อความ: "' + text + '"\nวิเคราะห์ว่าเป็นการเพิ่มบัตรเครดิตหรือตั้งแจ้งเตือนชำระ ตอบ JSON อย่างเดียว:\nถ้าใช่: {"isCard":true,"name":"ชื่อบัตร","dueDay":25}\nถ้าไม่ใช่: {"isCard":false}\n\nตัวอย่าง:\n"บัตร The1 ครบทุกวันที่ 25" → {"isCard":true,"name":"The1","dueDay":25}\n"KTC ชำระทุกวัน 15" → {"isCard":true,"name":"KTC","dueDay":15}\n"เพิ่มบัตร SCB ครบวันที่ 5" → {"isCard":true,"name":"SCB","dueDay":5}';
  try {
    const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
      payload: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 80, temperature: 0 }),
      muteHttpExceptions: true
    });
    let content = JSON.parse(res.getContentText()).choices[0].message.content.trim();
    content = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const p = JSON.parse(content);
    if (!p.isCard) { reply(replyToken, callOpenAI(text)); return; }
    const cards = getCreditCards();
    const idx = cards.findIndex(c => c.name.toLowerCase() === p.name.toLowerCase());
    if (idx >= 0) {
      cards[idx].dueDay = p.dueDay;
      saveCreditCards(cards);
      reply(replyToken, '✏️ อัปเดตแล้วค่ะ!\n💳 ' + p.name + '\n📅 ครบชำระทุกวันที่ ' + p.dueDay + ' ของทุกเดือน');
    } else {
      cards.push({ name: p.name, dueDay: p.dueDay });
      saveCreditCards(cards);
      reply(replyToken, '✅ บันทึกบัตรแล้วค่ะ!\n💳 ' + p.name + '\n📅 ครบชำระทุกวันที่ ' + p.dueDay + ' ของทุกเดือน\n\nจะแจ้งเตือนให้ทุกเดือนนะคะ 😊');
    }
  } catch(e) { reply(replyToken, '❌ ' + e.message); }
}

function handleListCards(replyToken) {
  const cards = getCreditCards();
  if (cards.length === 0) {
    reply(replyToken, '📭 ยังไม่มีบัตรที่บันทึกไว้ค่ะ\n\nพิมพ์เช่น:\n"บัตร The1 ครบทุกวันที่ 25"\nแล้วจะแจ้งเตือนให้ทุกเดือนเลยค่ะ');
    return;
  }
  const today = new Date().getDate();
  let msg = '💳 บัตรที่บันทึกไว้ ' + cards.length + ' ใบ\n────────────────\n';
  cards.forEach(c => {
    const daysUntil = c.dueDay >= today ? c.dueDay - today : (30 - today + c.dueDay);
    const status = daysUntil === 0 ? ' ⚠️ วันนี้!' : daysUntil <= 3 ? ' 🔴 อีก ' + daysUntil + ' วัน' : ' (วันที่ ' + c.dueDay + ' ทุกเดือน)';
    msg += '💳 ' + c.name + status + '\n';
  });
  reply(replyToken, msg.trim());
}

function handleDeleteCard(text, replyToken) {
  const match = text.match(/ลบบัตร\s+(.+)/);
  if (!match) { reply(replyToken, '❓ ระบุชื่อบัตรด้วยนะคะ เช่น "ลบบัตร The1"'); return; }
  const name = match[1].trim();
  const cards = getCreditCards();
  const idx = cards.findIndex(c => c.name.toLowerCase().includes(name.toLowerCase()));
  if (idx === -1) { reply(replyToken, '❌ ไม่พบบัตร "' + name + '" ค่ะ\nพิมพ์ "ดูบัตร" เพื่อดูรายชื่อ'); return; }
  const removed = cards.splice(idx, 1)[0];
  saveCreditCards(cards);
  reply(replyToken, '🗑 ลบบัตร ' + removed.name + ' แล้วค่ะ');
}

function checkBudgetAlert(category) {
  try {
    const ss = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID);
    const budgetSheet = ss.getSheetByName('Budgets');
    const txSheet = ss.getSheetByName('Transactions');
    if (!budgetSheet || !txSheet) return null;
    const currentMonth = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
    let limit = 0;
    budgetSheet.getDataRange().getValues().slice(1).forEach(row => {
      if (row[1] === category && (row[3] === currentMonth || row[3] === '')) limit = Number(row[2]);
    });
    if (limit === 0) return null;
    let spent = 0;
    txSheet.getDataRange().getValues().slice(1).forEach(row => {
      if (!row[0] || row[2] !== 'expense' || row[3] !== category) return;
      const d = new Date(row[1]);
      if (isNaN(d)) return;
      if (Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM') !== currentMonth) return;
      spent += Number(row[4]);
    });
    const pct = spent / limit * 100;
    if (pct >= 100) return '🔴 เกินงบ' + category + ' แล้วค่ะ!\n(' + spent.toLocaleString('th-TH') + '/' + limit.toLocaleString('th-TH') + ' ฿ = ' + pct.toFixed(0) + '%)';
    if (pct >= 80) return '🟡 ใกล้เต็มงบ ' + category + '!\n(' + spent.toLocaleString('th-TH') + '/' + limit.toLocaleString('th-TH') + ' ฿ = ' + pct.toFixed(0) + '%)';
    return null;
  } catch(e) { return null; }
}

function handleFinanceCategorySummary(replyToken) {
  try {
    const sheet = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID).getSheetByName('Transactions');
    if (!sheet) { reply(replyToken, '❌ ไม่พบ Finance Tracker'); return; }
    const now = new Date();
    const currentMonth = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM');
    const byCategory = {};
    sheet.getDataRange().getValues().slice(1).forEach(row => {
      if (!row[0] || row[2] !== 'expense') return;
      const d = new Date(row[1]);
      if (isNaN(d) || Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM') !== currentMonth) return;
      byCategory[row[3]] = (byCategory[row[3]] || 0) + Number(row[4]);
    });
    if (Object.keys(byCategory).length === 0) { reply(replyToken, '📭 เดือนนี้ยังไม่มีรายจ่ายค่ะ'); return; }
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    const total = sorted.reduce((s, [, v]) => s + v, 0);
    let msg = '📂 รายจ่ายแยกหมวด ' + months[now.getMonth()] + ' ' + (now.getFullYear() + 543) + '\n────────────────\n';
    sorted.forEach(([cat, amt]) => {
      const pct = (amt / total * 100).toFixed(0);
      msg += cat + ': ' + amt.toLocaleString('th-TH') + ' ฿ (' + pct + '%)\n';
    });
    msg += '────────────────\n💸 รวม: ' + total.toLocaleString('th-TH') + ' ฿';
    reply(replyToken, msg);
  } catch(e) { reply(replyToken, '❌ ' + e.message); }
}

function monthEndAlert() {
  try {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (tomorrow.getDate() !== 1) return; // ไม่ใช่วันสุดท้ายของเดือน
    const ss = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    const goalSheet = ss.getSheetByName('SavingGoals');
    if (!txSheet) return;
    const currentMonth = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM');
    let income = 0, expense = 0, saving = 0;
    txSheet.getDataRange().getValues().slice(1).forEach(row => {
      if (!row[0]) return;
      const d = new Date(row[1]);
      if (isNaN(d) || Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM') !== currentMonth) return;
      if (row[2] === 'income') income += Number(row[4]);
      if (row[2] === 'expense') expense += Number(row[4]);
      if (row[2] === 'saving') saving += Number(row[4]);
    });
    const savingRate = income > 0 ? (saving / income * 100).toFixed(1) : 0;
    const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    let msg = '📅 สรุปสิ้นเดือน ' + months[now.getMonth()] + ' ' + (now.getFullYear() + 543) + '\n════════════════\n';
    msg += '💰 รายรับ: ' + income.toLocaleString('th-TH') + ' ฿\n';
    msg += '💸 รายจ่าย: ' + expense.toLocaleString('th-TH') + ' ฿\n';
    msg += '🏦 ออม: ' + saving.toLocaleString('th-TH') + ' ฿\n';
    msg += '📊 อัตราออม: ' + savingRate + '%';
    if (goalSheet) {
      const activeGoals = goalSheet.getDataRange().getValues().slice(1).filter(r => r[0] && r[6] === 'active');
      if (activeGoals.length > 0) {
        msg += '\n\n🎯 เป้าหมายการออม:\n';
        activeGoals.forEach(row => {
          const target = Number(row[2]);
          const needed = target > 0 ? Math.ceil(target / Math.max(1, (() => {
            const s = new Date(row[4]), e = new Date(row[5]);
            return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
          })())) : 0;
          const pct = needed > 0 ? (saving / needed * 100).toFixed(0) : 0;
          const emoji = pct >= 100 ? '✅' : pct >= 50 ? '🟡' : '🔴';
          msg += emoji + ' ' + row[1] + ': ออมได้ ' + pct + '% ของเป้าเดือนนี้\n';
        });
      }
    }
    msg += Number(savingRate) >= 20 ? '\n🌟 ออมได้ดีมากค่ะ เดือนหน้าทำต่อไปนะ!' : Number(savingRate) < 10 ? '\n💡 เดือนหน้าลองตั้งเป้าออม 10% ดูนะคะ!' : '';
    push(msg);
  } catch(e) {}
}

// ─────────────────────────────────────────────
// DAILY NEWS
// ─────────────────────────────────────────────

function parseRssHeadlines(xmlText, count) {
  try {
    const doc = XmlService.parse(xmlText);
    const root = doc.getRootElement();
    const channel = root.getChild('channel');
    if (channel) {
      return channel.getChildren('item').slice(0, count)
        .map(item => item.getChildText('title'))
        .filter(Boolean);
    }
    // Atom fallback
    const ns = XmlService.getNamespace('http://www.w3.org/2005/Atom');
    return root.getChildren('entry', ns).slice(0, count)
      .map(entry => {
        const titleEl = entry.getChild('title', ns);
        return titleEl ? titleEl.getValue() : null;
      })
      .filter(Boolean);
  } catch(e) { return []; }
}

function fetchDailyNews(replyToken) {
  const newsBlocks = [];

  NEWS_SOURCES.forEach(src => {
    try {
      const res = UrlFetchApp.fetch(src.url, { muteHttpExceptions: true });
      const headlines = parseRssHeadlines(res.getContentText(), src.count);
      if (headlines.length > 0) {
        newsBlocks.push(src.label + ':\n' + headlines.map((h, i) => (i + 1) + '. ' + h).join('\n'));
      }
    } catch(e) {}
  });

  if (newsBlocks.length === 0) {
    const msg = '📰 ดึงข่าววันนี้ไม่ได้ค่ะ ลองใหม่ทีหลังนะคะ';
    if (replyToken) reply(replyToken, msg); else push(msg);
    return;
  }

  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy');
  const prompt = 'วันนี้ ' + today + '\nเป็นเลขาส่วนตัวของเจ้านาย เล่าข่าวเหล่านี้ให้เจ้านายฟังตอนเช้าแบบสนิทสนม กระชับ ภาษาพูดธรรมชาติ จัดแยกเป็น 3 หมวด (ทั่วไป / IT / กีฬา) แต่ละหมวดสรุปรวม 1-2 ประโยคสั้น ๆ ห้ามใช้ bullet list:\n\n' + newsBlocks.join('\n\n');

  try {
    const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
      payload: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 600 }),
      muteHttpExceptions: true
    });
    const summary = JSON.parse(res.getContentText()).choices[0].message.content;
    const msg = '🗞 ข่าวเช้า ' + today + '\n════════════════\n' + summary;
    if (replyToken) reply(replyToken, msg); else push(msg);
  } catch(e) {
    const msg = '❌ สรุปข่าวไม่ได้ค่ะ';
    if (replyToken) reply(replyToken, msg); else push(msg);
  }
}

function morningNews() {
  fetchDailyNews(null);
}

// ─────────────────────────────────────────────
function handleFinanceRecord(text, replyToken) {
  const today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  const prompt = 'ข้อความ: "' + text + '"\nวิเคราะห์ว่าเป็นรายการการเงินมั้ย ตอบ JSON อย่างเดียว:\nถ้าใช่: {"isFinance":true,"type":"income|expense|saving","amount":60,"category":"หมวด","note":"รายละเอียด","paymentMethod":"เงินสด"}\nถ้าไม่ใช่: {"isFinance":false}\n\nหมวด expense: อาหาร, เดินทาง, ช้อปปิ้ง, ค่าน้ำค่าไฟ, ค่าเช่า, สุขภาพ, ท่องเที่ยว, บันเทิง, การศึกษา, อื่น ๆ\nหมวด income: เงินเดือน, รายได้เสริม, โบนัส, อื่น ๆ\nหมวด saving: ออมทรัพย์, กองทุน\n\nช่องทางจ่าย (paymentMethod):\n- "บัตร", "บัตรเครดิต", "credit" → "บัตรเครดิต"\n- "โอน", "transfer" → "โอน"\n- "พร้อมเพย์", "promptpay", "pp" → "PromptPay"\n- ไม่ระบุ → "เงินสด"\n\nกฎ note: ใส่ชื่อสิ่งที่ซื้อ/รายการเสมอ ห้ามเว้นว่าง\n\nตัวอย่าง:\n"กาแฟ 60" → expense 60 อาหาร เงินสด note:"กาแฟ"\n"ค่าก๋วยเตี๋ยว 120 โอน" → expense 120 อาหาร โอน note:"ก๋วยเตี๋ยว"\n"กาแฟ 60 บัตร" → expense 60 อาหาร บัตรเครดิต note:"กาแฟ"\n"BTS 44 โอน" → expense 44 เดินทาง โอน note:"BTS"\n"ค่าน้ำมัน 500" → expense 500 เดินทาง เงินสด note:"น้ำมัน"\n"ออม 5000" → saving 5000 ออมทรัพย์ โอน note:""\n"รับเงินเดือน 35000" → income 35000 เงินเดือน โอน note:"เงินเดือน"\n"นัดหมอ พรุ่งนี้" → isFinance:false';

  try {
    const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + OPENAI_KEY },
      payload: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 100, temperature: 0 }),
      muteHttpExceptions: true
    });
    let content = JSON.parse(res.getContentText()).choices[0].message.content.trim();
    content = content.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const p = JSON.parse(content);

    if (!p.isFinance) {
      reply(replyToken, callOpenAI(text));
      return;
    }

    const sheet = SpreadsheetApp.openById(FINANCE_SPREADSHEET_ID).getSheetByName('Transactions');
    if (!sheet) { reply(replyToken, '❌ ไม่พบ Finance Tracker'); return; }

    const id = Utilities.getUuid().replace(/-/g,'').substr(0, 12);
    const now = new Date().toISOString();
    const payMethod = p.paymentMethod || 'เงินสด';
    sheet.appendRow([id, today, p.type, p.category, p.amount, payMethod, p.note || '', now, now]);

    const icon = { income: '💰', expense: '💸', saving: '🏦' }[p.type];
    const label = { income: 'รายรับ', expense: 'รายจ่าย', saving: 'ออมเงิน' }[p.type];
    let msg = '✅ บันทึกแล้วค่ะ!\n' + icon + ' ' + label + ': ' + Number(p.amount).toLocaleString('th-TH') + ' ฿\n📂 ' + p.category + '  💳 ' + payMethod;
    if (p.note) msg += '\n📝 ' + p.note;
    if (p.type === 'expense') {
      const alert = checkBudgetAlert(p.category);
      if (alert) msg += '\n\n' + alert;
    }
    reply(replyToken, msg);

  } catch(e) { reply(replyToken, '❌ ' + e.message); }
}
