const { MongoClient } = require('mongodb');

// ใช้ค่าเดียวกับ server.js
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://nippit62:ohm0966477158@testing.hgxbz.mongodb.net/?retryWrites=true&w=majority';
const DB_NAME = 'momay_buu';
const COLLECTION = 'bookings';

function pad(n){return String(n).padStart(2,'0');}

(async function(){
  const client = new MongoClient(MONGODB_URI);
  try{
    await client.connect();
    const db = client.db(DB_NAME);
    const now = new Date();
    const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;

    // กำหนดช่วงเวลาให้ครอบคลุมเวลาปัจจุบัน
    const start = new Date(now.getTime() - 15*60000); // 15 นาทีก่อน
    const end = new Date(now.getTime() + 60*60000); // 60 นาทีหลัง
    const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;

    const booking = {
      bookingId: 'TEST',
      room: 'ห้องทดสอบ',
      date: today,
      startTime: startTime,
      endTime: endTime,
      bookerName: 'Automated Tester',
      purpose: 'integration test',
      firstCheckIn: null
    };

    await db.collection(COLLECTION).updateOne({ bookingId: booking.bookingId }, { $set: booking }, { upsert: true });
    console.log('Inserted/updated booking:', booking);
  }catch(e){
    console.error('Error inserting test booking:', e);
    process.exitCode = 2;
  }finally{
    await client.close();
  }
})();
