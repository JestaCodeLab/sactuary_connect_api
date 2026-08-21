import 'dotenv/config';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import axios from 'axios';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';
const BASE = 'http://localhost:5000';
const REAL_ORG_ID = '69ccf310413d4fa8822aae3c';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const User = mongoose.connection.collection('users');
  const admin = await User.findOne({ organizationId: new mongoose.Types.ObjectId(REAL_ORG_ID), role: 'admin' });
  const token = jwt.sign({ userId: admin._id.toString(), role: 'admin', organizationId: REAL_ORG_ID }, JWT_SECRET, { expiresIn: '10m' });
  const headers = { Authorization: `Bearer ${token}` };

  const attempt = async (label, fn) => {
    try {
      const res = await fn();
      console.log(`${label}: HTTP ${res.status}`, JSON.stringify(res.data).slice(0, 200));
      return res.data;
    } catch (err) {
      console.log(`${label}: HTTP ${err.response?.status} - ${JSON.stringify(err.response?.data)}`);
    }
  };

  console.log('=== Removed dangerous endpoint (should 404) ===');
  await attempt('POST credits/purchase (removed)', () => axios.post(`${BASE}/api/sms/credits/purchase`, { amount: 999999 }, { headers }));

  console.log('\n=== Templates CRUD ===');
  const created = await attempt('POST template', () => axios.post(`${BASE}/api/sms/templates`, { name: 'Test Template', message: 'Hello {{firstName}}, test message', category: 'general' }, { headers }));
  const templateId = created?._id;
  await attempt('GET templates list', () => axios.get(`${BASE}/api/sms/templates`, { headers }));
  if (templateId) {
    await attempt('GET single template', () => axios.get(`${BASE}/api/sms/templates/${templateId}`, { headers }));
    await attempt('PUT update template', () => axios.put(`${BASE}/api/sms/templates/${templateId}`, { name: 'Updated Test Template' }, { headers }));
    await attempt('POST duplicate template', () => axios.post(`${BASE}/api/sms/templates/${templateId}/duplicate`, {}, { headers }));
    await attempt('DELETE template', () => axios.delete(`${BASE}/api/sms/templates/${templateId}`, { headers }));
    await attempt('GET deleted template (should 404, soft-deleted)', () => axios.get(`${BASE}/api/sms/templates/${templateId}`, { headers }));
  }

  console.log('\n=== Credits balance + calc cost ===');
  await attempt('GET credits balance', () => axios.get(`${BASE}/api/sms/credits/balance`, { headers }));
  await attempt('POST calculate cost', () => axios.post(`${BASE}/api/sms/calculate-cost`, { message: 'Test message for cost calc', recipientCount: 5 }, { headers }));

  console.log('\n=== SMS logs/analytics ===');
  await attempt('GET sms logs', () => axios.get(`${BASE}/api/sms/logs?limit=3`, { headers }));
  await attempt('GET sms analytics', () => axios.get(`${BASE}/api/sms/analytics`, { headers }));

  await mongoose.disconnect();
}
main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
