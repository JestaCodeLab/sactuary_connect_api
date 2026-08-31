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
// getRoleById is the one exception: it also allows a 'custom' user to fetch
// their own assigned role (ownership check lives in the controller, since it
// needs a DB lookup) - the client's usePermissions hook depends on that
// self-lookup to resolve which permissions it was actually granted.
router.get('/permissions', getPermissionTaxonomy);
router.get('/', authorizeRole(['admin']), getRoles);
router.get('/:id', getRoleById);
router.post('/', authorizeRole(['admin']), createRole);
router.put('/:id', authorizeRole(['admin']), updateRole);
router.delete('/:id', authorizeRole(['admin']), deactivateRole);

export default router;
