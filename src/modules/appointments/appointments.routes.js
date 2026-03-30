const { Router } = require('express');
const ctrl = require('./appointments.controller');
const { authenticate, requireTenant } = require('../../shared/middleware/auth');
const { asyncHandler } = require('../../shared/utils/asyncHandler');
const { planLimit } = require('../../shared/middleware/planLimits');
const { validate, validateId, schemas } = require('../../shared/middleware/validate');

const router = Router();
router.use(authenticate, requireTenant);

// GET    /api/appointments?date=2024-03-15&status=pending
router.get('/', asyncHandler(ctrl.list));

// GET    /api/appointments/today  (atajo para la agenda del día)
router.get('/today', asyncHandler(ctrl.today));

// GET    /api/appointments/:id
router.get('/:id', validateId, asyncHandler(ctrl.getById));

// POST   /api/appointments  (crear turno)
router.post('/', planLimit('appointments'), validate(schemas.appointmentCreate), asyncHandler(ctrl.create));

// PATCH  /api/appointments/:id  (editar turno)
router.patch('/:id', asyncHandler(ctrl.update));

// PATCH  /api/appointments/:id/status  (cambiar estado - la acción más frecuente)
router.patch('/:id/status', validateId, validate(schemas.statusChange), asyncHandler(ctrl.changeStatus));

// POST   /api/appointments/quick  (turno rápido: busca/crea cliente+vehículo+turno en 1 call)
router.post('/quick', planLimit('appointments'), validate(schemas.appointmentQuick), asyncHandler(ctrl.quickCreate));



module.exports = router;
