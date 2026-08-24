import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import path from 'path';
import connectDB from './config/database.js';
import { cleanupExports } from './utils/exportCleanup.js';
import { startRecurringQRJob } from './jobs/recurringQRJob.js';
import { initBirthdayJob } from './jobs/birthdayJob.js';
import { initServiceCodeGenerationJob } from './jobs/serviceCodeGenerationJob.js';
import { initShepherdAlertJob } from './jobs/shepherdAlertJob.js';
import { initEventReminderJob } from './jobs/eventReminderJob.js';
import { startSmsDeliveryStatusJob } from './jobs/smsDeliveryStatusJob.js';
import { initSubscriptionExpiryJob } from './jobs/subscriptionExpiryJob.js';

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
import publicGivingRoutes from './routes/publicGivingRoutes.js';
import userBranchRoutes from './routes/userBranchRoutes.js';
import userDepartmentRoutes from './routes/userDepartmentRoutes.js';
import roleRoutes from './routes/roleRoutes.js';
import smsRoutes from './routes/smsRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import shepherdAlertRoutes from './routes/shepherdAlertRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import superadminRoutes from './routes/superadminRoutes.js';
import invitationRoutes from './routes/invitationRoutes.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://app.sanctuaryconnect.org',
    process.env.CLIENT_URL,
  ].filter(Boolean),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.use('/api/public/giving', publicGivingRoutes);
app.use('/api', userBranchRoutes);
app.use('/api', userDepartmentRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/shepherd-alerts', shepherdAlertRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/invitations', invitationRoutes);

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

    // Start service code generation job (for recurring event occurrences)
    initServiceCodeGenerationJob();

    // Start shepherd alert automation job (8:00 AM daily)
    initShepherdAlertJob();

    // Start event reminder automation job (every 15 minutes)
    initEventReminderJob();

    // Start SMS delivery status polling job (every 5 minutes)
    startSmsDeliveryStatusJob();

    // Start subscription expiry notification job (8:30 AM daily)
    initSubscriptionExpiryJob();

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
