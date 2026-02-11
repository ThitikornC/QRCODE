const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MongoClient, ObjectId } = require('mongodb');

const port = process.env.PORT || 8001;
const httpsPort = 8443;
const root = path.resolve(__dirname);

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://nippit62:ohm0966477158@testing.hgxbz.mongodb.net/?retryWrites=true&w=majority';
const DB_NAME = 'momay_buu';
const COLLECTION_NAME = 'bookings';

let db = null;

async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('QR Scanner Server connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error);
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html';
    case '.js': return 'application/javascript';
    case '.css': return 'text/css';
    case '.json': return 'application/json';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function isWithinBookingTime(booking) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  if (booking.date !== today) {
    const bookingDate = new Date(booking.date);
    const todayDate = new Date(today);
    if (bookingDate < todayDate) {
      return { valid: false, reason: 'expired', message: 'การจองนี้หมดอายุแล้ว' };
    }
    return { valid: false, reason: 'not_today', message: `การจองนี้สำหรับวันที่ ${booking.date}` };
  }
  
  const [startHour, startMin] = booking.startTime.split(':').map(Number);
  const [endHour, endMin] = booking.endTime.split(':').map(Number);
  
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  const earlyAllowance = 15;
  
  if (currentMinutes < startMinutes - earlyAllowance) {
    const waitMinutes = startMinutes - earlyAllowance - currentMinutes;
    return { 
      valid: false, 
      reason: 'too_early', 
      message: `ยังไม่ถึงเวลา กรุณารออีก ${waitMinutes} นาที`,
      waitMinutes
    };
  }
  
  if (currentMinutes > endMinutes) {
    return { valid: false, reason: 'too_late', message: 'เลยเวลาการจองแล้ว' };
  }
  
  return { valid: true, reason: 'ok', message: 'เข้าห้องได้' };
}

async function handleAPI(req, res) {
  const url = req.url.split('?')[0];
  const method = req.method;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  if (method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return true;
  }
  
  if (url === '/api/verify' && method === 'POST') {
    try {
      const body = await parseBody(req);
      let { qrData } = body;
      
      if (!qrData) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'ไม่พบข้อมูล QR Code' }));
        return true;
      }
      
      let bookingId = qrData;
      if (qrData.startsWith('BK:')) {
        bookingId = qrData.substring(3);
      }
      
      const booking = await db.collection(COLLECTION_NAME).findOne({ bookingId });
      
      if (!booking) {
        res.statusCode = 404;
        res.end(JSON.stringify({ 
          success: false, 
          access: false,
          error: 'ไม่พบข้อมูลการจอง',
          bookingId
        }));
        return true;
      }
      
      const timeCheck = isWithinBookingTime(booking);
      
      const now = new Date();
      let firstCheckIn = booking.firstCheckIn;
      let isFirstCheckIn = false;
      
      // ถ้าเข้าได้และยังไม่เคย check-in ให้บันทึกเวลา check-in ครั้งแรก
      if (timeCheck.valid && !firstCheckIn) {
        firstCheckIn = now.toISOString();
        isFirstCheckIn = true;
        await db.collection(COLLECTION_NAME).updateOne(
          { bookingId: booking.bookingId },
          { $set: { firstCheckIn: firstCheckIn } }
        );
      }
      
      // คำนวณเวลาที่เหลือจนหมดเวลาจอง (timezone-safe)
      const [endHour, endMin] = booking.endTime.split(':').map(Number);
      const currentSecs = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const endSecs = endHour * 3600 + endMin * 60;
      const remainingSeconds = Math.max(0, endSecs - currentSecs);
      
      const accessLog = {
        bookingId: booking.bookingId,
        room: booking.room,
        bookerName: booking.bookerName,
        attemptTime: now.toISOString(),
        accessGranted: timeCheck.valid,
        reason: timeCheck.reason,
        isFirstCheckIn: isFirstCheckIn
      };
      
      await db.collection('access_logs').insertOne(accessLog);
      
      res.statusCode = 200;
      res.end(JSON.stringify({
        success: true,
        access: timeCheck.valid,
        message: timeCheck.message,
        reason: timeCheck.reason,
        isFirstCheckIn: isFirstCheckIn,
        firstCheckIn: firstCheckIn,
        remainingSeconds: remainingSeconds,
        booking: {
          bookingId: booking.bookingId,
          room: booking.room,
          date: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
          bookerName: booking.bookerName,
          purpose: booking.purpose
        }
      }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
    return true;
  }
  
  if (url === '/api/logs' && method === 'GET') {
    try {
      const urlParams = new URL(req.url, `http://localhost:${port}`);
      const date = urlParams.searchParams.get('date');
      const room = urlParams.searchParams.get('room');
      
      const query = {};
      if (date) {
        query.attemptTime = { 
          $gte: `${date}T00:00:00`,
          $lte: `${date}T23:59:59`
        };
      }
      if (room) query.room = room;
      
      const logs = await db.collection('access_logs')
        .find(query)
        .sort({ attemptTime: -1 })
        .limit(100)
        .toArray();
        
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, data: logs }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
    return true;
  }
  
  return false;
}

async function handleRequest(req, res) {
  if (req.url.startsWith('/api/')) {
    await handleAPI(req, res);
    return;
  }
  
  const decoded = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(root, decoded === '/' ? 'index.html' : decoded);
  
  if (!filePath.startsWith(root)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  
  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 500;
        res.end('Server error');
        return;
      }
      res.setHeader('Content-Type', getContentType(filePath));
      res.end(data);
    });
  });
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const server = http.createServer(handleRequest);

let httpsServer = null;
const certPath = path.join(__dirname, 'cert.crt');
const keyPath = path.join(__dirname, 'cert.key');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  httpsServer = https.createServer(httpsOptions, handleRequest);
}

connectDB().then(() => {
  const localIP = getLocalIP();
  
  server.listen(port, '0.0.0.0', () => {
    console.log('HTTP: http://localhost:' + port + '/');
  });
  
  if (httpsServer) {
    httpsServer.listen(httpsPort, '0.0.0.0', () => {
      console.log('');
      console.log('📱 สำหรับมือถือ (ใช้กล้องได้):');
      console.log('   https://' + localIP + ':' + httpsPort + '/');
      console.log('');
      console.log('⚠️  มือถือจะแจ้งเตือน "ไม่ปลอดภัย"');
      console.log('   กด "ขั้นสูง" แล้ว "ดำเนินการต่อ"');
    });
  }
});
