/**
 * Wrapper para rutas async. Captura errores y los pasa a Express.
 * Evita tener try/catch en cada route handler.
 *
 * Uso:
 *   router.get('/users', asyncHandler(async (req, res) => {
 *     const users = await getUsers();
 *     res.json(users);
 *   }));
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
