import express from 'express';
import {
  getPermissionTaxonomy,
  getRoles,
  getRoleById,
  createRole,
  updateRole,
  deactivateRole,
} from '../controllers/roleController.js';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

// Role management is always admin-only - a custom role must never be able
// to grant the ability to create/edit more roles (privilege escalation guard).
router.get('/permissions', getPermissionTaxonomy);
router.get('/', authorizeRole(['admin']), getRoles);
router.get('/:id', authorizeRole(['admin']), getRoleById);
router.post('/', authorizeRole(['admin']), createRole);
router.put('/:id', authorizeRole(['admin']), updateRole);
router.delete('/:id', authorizeRole(['admin']), deactivateRole);

export default router;
