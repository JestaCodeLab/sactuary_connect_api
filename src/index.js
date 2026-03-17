import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import connectDB from './config/database.js';
import { cleanupExports } from './utils/exportCleanup.js';
import { startRecurringQRJob } from './jobs/recurringQRJob.js';
import { initBirthdayJob } from './jobs/birthdayJob.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import errorHandler from './middleware/errorHandler.js';
import authRoutes from './routes/authRoutes.js';
import memberRoutes from './routes/memberRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import donationRoutes from './routes/donationRoutes.js';
import organizationRoutes from './routes/organizationRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import prayerRequestRoutes from './routes/prayerRequestRoutes.js';
import departmentRoutes from './routes/departmentRoutes.js';
import expenseRoutes from './routes/expenseRoutes.js';
import financeRoutes from './routes/financeRoutes.js';
import userBranchRoutes from './routes/userBranchRoutes.js';
import smsRoutes from './routes/smsRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import shepherdAlertRoutes from './routes/shepherdAlertRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://www.sanctuaryconnect.org',
    'https://sanctuaryconnect.org',
    'https://app.sanctuaryconnect.org',
    process.env.CLIENT_URL,
  ].filter(Boolean),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve export files statically
app.use('/exports', express.static(path.join(__dirname, '../exports')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/donations', donationRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/prayer-requests', prayerRequestRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api', userBranchRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/shepherd-alerts', shepherdAlertRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'API is running' });
});

// Error handling
app.use(errorHandler);

// Initialize database and start server
const startServer = async () => {
  try {
    await connectDB();
    // Clean up old export files every hour
    cleanupExports();
    setInterval(cleanupExports, 60 * 60 * 1000);

    // Start recurring event QR code auto-generation job
    startRecurringQRJob();

    // Start birthday SMS automation job (9:00 AM daily)
    initBirthdayJob();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
