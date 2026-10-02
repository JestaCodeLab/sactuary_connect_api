import express from 'express';
import multer from 'multer';
import {
  getAllDonations,
  getDonationById,
  createDonation,
  updateDonation,
  deleteDonation,
  uploadDonationAttachment,
  getDonationStats,
  sendReceipt
} from '../controllers/donationController.js';
import { authenticateToken, authorizeRoleOrPermission } from '../middleware/auth.js';
import { resolveBranchContext } from '../middleware/branchContext.js';
import { requireFeature, financeAccountApproved } from '../middleware/featureGate.js';

const router = express.Router();

// Proof-of-payment uploads: memory storage, max 5MB, PDF or image
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, JPEG, PNG, and WebP are allowed.'));
    }
  },
});

router.post('/attachment', authenticateToken, resolveBranchContext, financeAccountApproved(), requireFeature('online_giving'), upload.single('file'), uploadDonationAttachment);
router.get('/stats/summary', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.view'), financeAccountApproved(), requireFeature('online_giving'), getDonationStats);
router.get('/', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.view'), financeAccountApproved(), requireFeature('online_giving'), getAllDonations);
router.get('/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.view'), financeAccountApproved(), requireFeature('online_giving'), getDonationById);
router.post('/', authenticateToken, resolveBranchContext, financeAccountApproved(), requireFeature('online_giving'), createDonation);
router.put('/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.manage'), financeAccountApproved(), requireFeature('online_giving'), updateDonation);
router.delete('/:id', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.manage'), financeAccountApproved(), requireFeature('online_giving'), deleteDonation);
router.post('/:id/receipt', authenticateToken, resolveBranchContext, authorizeRoleOrPermission(['admin', 'pastor'], 'donations.manage'), financeAccountApproved(), requireFeature('online_giving'), sendReceipt);

export default router;
