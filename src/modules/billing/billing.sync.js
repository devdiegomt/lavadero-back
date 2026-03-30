/**
 * Sincronización de datos entre Carwash SaaS y Alegra.
 * 
 * Mantiene en sync:
 *  - Clientes del lavadero ↔ Contactos de Alegra
 *  - Servicios del lavadero ↔ Ítems de Alegra
 * 
 * Usa una tabla de mapeo (billing_sync) para rastrear IDs.
 */

const db = require('../../shared/db');
const { createAlegraClientForTenant } = require('./alegra.client');
const { centsToPesos } = require('../../shared/utils/pricing');

// ═══════════════════════════════════════════════════════════════════════
// SYNC DE CLIENTES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Sincroniza un cliente del lavadero con Alegra.
 * Si ya existe en Alegra (mapeado), lo actualiza. Si no, lo crea.
 * 
 * @param {string} customerId - ID del cliente en Carwash SaaS
 * @param {string} tenantId - ID del tenant
 * @returns {string} alegraContactId
 */
async function syncCustomerToAlegra(customerId, tenantId) {
  const tenant = await getTenant(tenantId);
  const alegra = createAlegraClientForTenant(tenant);
  if (!alegra) throw new Error('Alegra no configurado para este tenant');

  // Obtener datos del cliente
  const { rows } = await db.query(
    `SELECT * FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [customerId, tenantId]
  );
  if (rows.length === 0) throw new Error('Cliente no encontrado');
  const customer = rows[0];

  // Buscar mapeo existente
  const existingMapping = await getMapping(tenantId, 'customer', customerId);

  if (existingMapping) {
    // Actualizar en Alegra
    try {
      await alegra.updateContact(existingMapping.external_id, {
        name: buildContactName(customer),
        phonePrimary: customer.phone || undefined,
        email: customer.email || undefined,
      });
      return existingMapping.external_id;
    } catch (err) {
      // Si el contacto fue eliminado en Alegra, re-crear
      if (err.statusCode === 404) {
        await deleteMapping(tenantId, 'customer', customerId);
      } else {
        throw err;
      }
    }
  }

  // Buscar por documento en Alegra (evitar duplicados)
  if (customer.document_number) {
    const existing = await alegra.findContactByDocument(customer.document_number);
    if (existing) {
      await saveMapping(tenantId, 'customer', customerId, existing.id.toString());
      return existing.id.toString();
    }
  }

  // Crear contacto nuevo en Alegra
  const contact = await alegra.createContact({
    name: buildContactName(customer),
    identification: customer.document_number || undefined,
    documentType: customer.document_type || 'CC',
    phonePrimary: customer.phone,
    email: customer.email || undefined,
  });

  await saveMapping(tenantId, 'customer', customerId, contact.id.toString());
  return contact.id.toString();
}

// ═══════════════════════════════════════════════════════════════════════
// SYNC DE SERVICIOS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Sincroniza un servicio del lavadero como ítem en Alegra.
 * 
 * @param {string} serviceId - ID del servicio
 * @param {string} tenantId - ID del tenant
 * @param {string} vehicleType - Tipo de vehículo (para el precio correcto)
 * @returns {object} { alegraItemId, price } price en pesos (no centavos)
 */
async function syncServiceToAlegra(serviceId, tenantId, vehicleType = 'sedan') {
  const tenant = await getTenant(tenantId);
  const alegra = createAlegraClientForTenant(tenant);
  if (!alegra) throw new Error('Alegra no configurado para este tenant');

  // Obtener servicio
  const { rows } = await db.query(
    'SELECT * FROM services WHERE id = $1 AND tenant_id = $2',
    [serviceId, tenantId]
  );
  if (rows.length === 0) throw new Error('Servicio no encontrado');
  const service = rows[0];

  // El precio depende del tipo de vehículo
  const priceKey = `price_${vehicleType}`;
  const priceInCents = service[priceKey] || service.price_sedan || 0;
  const priceInPesos = centsToPesos(priceInCents);

  // Generar un mapping key que incluya el tipo de vehículo
  // porque un mismo servicio puede tener diferentes precios
  const mappingKey = `${serviceId}:${vehicleType}`;
  const existingMapping = await getMapping(tenantId, 'service', mappingKey);

  if (existingMapping) {
    // Verificar si el precio cambió
    const storedPrice = existingMapping.metadata?.price;
    if (storedPrice && parseInt(storedPrice) === priceInPesos) {
      return { alegraItemId: existingMapping.external_id, price: priceInPesos };
    }

    // Precio cambió, actualizar en Alegra
    try {
      await alegra.updateItem(existingMapping.external_id, { price: priceInPesos });
      await updateMappingMetadata(tenantId, 'service', mappingKey, { price: priceInPesos });
      return { alegraItemId: existingMapping.external_id, price: priceInPesos };
    } catch (err) {
      if (err.statusCode === 404) {
        await deleteMapping(tenantId, 'service', mappingKey);
      } else {
        throw err;
      }
    }
  }

  // Crear ítem en Alegra
  const itemName = vehicleType !== 'sedan'
    ? `${service.name} (${vehicleType.toUpperCase()})`
    : service.name;

  const item = await alegra.createItem({
    name: itemName,
    description: service.description || `Servicio de ${service.name}`,
    price: priceInPesos,
    productKey: '78181500', // UNSPSC: Lavado de vehículos
  });

  await saveMapping(tenantId, 'service', mappingKey, item.id.toString(), { price: priceInPesos });
  return { alegraItemId: item.id.toString(), price: priceInPesos };
}

// ═══════════════════════════════════════════════════════════════════════
// SYNC COMPLETO (para onboarding o re-sync)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Sincroniza todos los servicios activos de un tenant con Alegra.
 * Útil en el onboarding o cuando se cambia de proveedor de facturación.
 */
async function syncAllServicesToAlegra(tenantId) {
  const { rows: services } = await db.query(
    'SELECT * FROM services WHERE tenant_id = $1 AND is_active = true',
    [tenantId]
  );

  const results = [];
  const vehicleTypes = ['sedan', 'suv', 'camioneta', 'moto', 'pickup'];

  for (const service of services) {
    for (const vt of vehicleTypes) {
      const priceKey = `price_${vt}`;
      if (service[priceKey] > 0) {
        try {
          const result = await syncServiceToAlegra(service.id, tenantId, vt);
          results.push({ service: service.name, vehicleType: vt, ...result, status: 'ok' });
        } catch (err) {
          results.push({ service: service.name, vehicleType: vt, error: err.message, status: 'error' });
        }
      }
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS: Tabla de mapeo billing_sync
// ═══════════════════════════════════════════════════════════════════════

async function getMapping(tenantId, entityType, localId) {
  const { rows } = await db.query(
    `SELECT * FROM billing_sync
     WHERE tenant_id = $1 AND entity_type = $2 AND local_id = $3`,
    [tenantId, entityType, localId]
  );
  return rows[0] || null;
}

async function saveMapping(tenantId, entityType, localId, externalId, metadata = null) {
  await db.query(
    `INSERT INTO billing_sync (tenant_id, entity_type, local_id, external_id, metadata)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, entity_type, local_id)
     DO UPDATE SET external_id = $4, metadata = COALESCE($5::jsonb, billing_sync.metadata), synced_at = NOW()`,
    [tenantId, entityType, localId, externalId, metadata ? JSON.stringify(metadata) : null]
  );
}

async function deleteMapping(tenantId, entityType, localId) {
  await db.query(
    'DELETE FROM billing_sync WHERE tenant_id = $1 AND entity_type = $2 AND local_id = $3',
    [tenantId, entityType, localId]
  );
}

async function updateMappingMetadata(tenantId, entityType, localId, metadata) {
  await db.query(
    `UPDATE billing_sync SET metadata = metadata || $4::jsonb, synced_at = NOW()
     WHERE tenant_id = $1 AND entity_type = $2 AND local_id = $3`,
    [tenantId, entityType, localId, JSON.stringify(metadata)]
  );
}

async function getTenant(tenantId) {
  const { rows } = await db.query('SELECT * FROM tenants WHERE id = $1', [tenantId]);
  if (rows.length === 0) throw new Error('Tenant no encontrado');
  return rows[0];
}

function buildContactName(customer) {
  return [customer.first_name, customer.last_name].filter(Boolean).join(' ');
}

module.exports = {
  syncCustomerToAlegra,
  syncServiceToAlegra,
  syncAllServicesToAlegra,
};
