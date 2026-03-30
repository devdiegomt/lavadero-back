/**
 * Cliente para la API de Alegra (https://developer.alegra.com)
 * 
 * Alegra usa Basic Auth: Base64(email:token)
 * Base URL: https://api.alegra.com/api/v1
 * Sandbox:  https://api.alegra.com/api/v1 (misma URL, cuenta sandbox separada)
 * 
 * Rate limit: 60 req/min
 */

const ALEGRA_BASE_URL = 'https://api.alegra.com/api/v1';

class AlegraClient {
  /**
   * @param {string} email - Email de la cuenta Alegra
   * @param {string} token - Token API de Alegra (Configuración → Integraciones → API)
   */
  constructor(email, token) {
    this.email = email;
    this.token = token;
    this.auth = Buffer.from(`${email}:${token}`).toString('base64');
  }

  async _request(method, path, body = null, params = null) {
    let url = `${ALEGRA_BASE_URL}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }

    const options = {
      method,
      headers: {
        'Authorization': `Basic ${this.auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const error = new Error(
        data?.message || data?.error || `Alegra API error: ${response.status}`
      );
      error.statusCode = response.status;
      error.alegraError = data;
      throw error;
    }

    return data;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CONTACTOS (Clientes en Alegra)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Busca un contacto por número de documento (NIT/CC).
   */
  async findContactByDocument(documentNumber) {
    const contacts = await this._request('GET', '/contacts', null, {
      identification: documentNumber,
    });
    return Array.isArray(contacts) && contacts.length > 0 ? contacts[0] : null;
  }

  /**
   * Busca un contacto por nombre.
   */
  async findContactByName(name) {
    const contacts = await this._request('GET', '/contacts', null, {
      name,
    });
    return Array.isArray(contacts) && contacts.length > 0 ? contacts[0] : null;
  }

  /**
   * Crea un contacto (cliente) en Alegra.
   * @param {object} contact
   * @param {string} contact.name - Nombre completo o razón social
   * @param {string} contact.identification - NIT o CC
   * @param {string} [contact.phonePrimary] - Teléfono
   * @param {string} [contact.email] - Email
   * @param {string} [contact.address] - Dirección
   * @param {string} [contact.city] - Ciudad
   * @param {string} [contact.kindOfPerson] - 'PERSON_ENTITY' o 'LEGAL_ENTITY'
   * @param {string} [contact.regime] - 'SIMPLIFIED_REGIME' o 'COMMON_REGIME'
   */
  async createContact(contact) {
    return this._request('POST', '/contacts', {
      name: contact.name,
      identification: contact.identification || undefined,
      phonePrimary: contact.phonePrimary || undefined,
      email: contact.email || undefined,
      address: contact.address ? { address: contact.address, city: contact.city || undefined } : undefined,
      type: ['client'],
      // Colombia-specific fields
      kindOfPerson: contact.kindOfPerson || 'PERSON_ENTITY',
      regime: contact.regime || 'SIMPLIFIED_REGIME',
      identificationObject: contact.identification ? {
        type: contact.documentType || 'CC', // CC, NIT, CE, PP, etc.
        number: contact.identification,
      } : undefined,
    });
  }

  /**
   * Actualiza un contacto existente.
   */
  async updateContact(alegraContactId, data) {
    return this._request('PUT', `/contacts/${alegraContactId}`, data);
  }

  /**
   * Obtiene un contacto por ID.
   */
  async getContact(alegraContactId) {
    return this._request('GET', `/contacts/${alegraContactId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ÍTEMS (Servicios/Productos en Alegra)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crea un ítem (servicio) en Alegra.
   * @param {object} item
   * @param {string} item.name - Nombre del servicio
   * @param {number} item.price - Precio unitario (en pesos, no centavos)
   * @param {string} [item.description] - Descripción
   * @param {Array} [item.tax] - Impuestos [{id: taxId}]
   */
  async createItem(item) {
    return this._request('POST', '/items', {
      name: item.name,
      description: item.description || undefined,
      price: item.price,
      type: 'service', // Los lavados son servicios, no productos
      tax: item.tax || [],
      // Código de producto DIAN (requerido para facturación electrónica)
      productKey: item.productKey || '78181500', // Lavado de vehículos (UNSPSC)
    });
  }

  /**
   * Lista todos los ítems.
   */
  async listItems(params = {}) {
    return this._request('GET', '/items', null, params);
  }

  /**
   * Obtiene un ítem por ID.
   */
  async getItem(itemId) {
    return this._request('GET', `/items/${itemId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FACTURAS DE VENTA
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crea una factura de venta.
   * 
   * @param {object} invoice
   * @param {string} invoice.date - Fecha (YYYY-MM-DD)
   * @param {string} invoice.dueDate - Fecha de vencimiento
   * @param {object} invoice.client - { id: alegraContactId }
   * @param {Array} invoice.items - [{ id, price, quantity, tax? }]
   * @param {string} [invoice.paymentMethod] - Medio de pago
   * @param {string} [invoice.observations] - Notas visibles en la factura
   * @param {object} [invoice.stamp] - Para emitir electrónicamente: { generateStamp: true }
   * @param {string} [invoice.numberTemplate] - { id: templateId } Numeración
   */
  async createInvoice(invoice) {
    // Mapeo de métodos de pago del lavadero a códigos Alegra/DIAN
    const paymentMethodMap = {
      cash: 'cash',             // Efectivo → 10
      nequi: 'transfer',       // Nequi → Transferencia → 47
      daviplata: 'transfer',   // Daviplata → Transferencia → 47
      transfer: 'transfer',    // Transferencia bancaria → 47
      card: 'credit-card',     // Tarjeta → 48
    };

    const body = {
      date: invoice.date,
      dueDate: invoice.dueDate || invoice.date,
      client: invoice.client,
      items: invoice.items.map(item => ({
        id: item.id,
        price: item.price,
        quantity: item.quantity || 1,
        description: item.description || undefined,
        tax: item.tax || [],
      })),
      paymentMethod: paymentMethodMap[invoice.paymentMethod] || 'cash',
      paymentForm: 'CASH', // Pago de contado (para lavaderos siempre es de contado)
      observations: invoice.observations || undefined,
      anotation: invoice.internalNotes || undefined,
      numberTemplate: invoice.numberTemplate || undefined,
      stamp: invoice.stamp || { generateStamp: true }, // Emitir electrónicamente por defecto
    };

    return this._request('POST', '/invoices', body);
  }

  /**
   * Consulta una factura por ID. Incluye estado DIAN, CUFE, PDF URL.
   */
  async getInvoice(invoiceId) {
    return this._request('GET', `/invoices/${invoiceId}`);
  }

  /**
   * Lista facturas con filtros.
   */
  async listInvoices(params = {}) {
    return this._request('GET', '/invoices', null, params);
  }

  /**
   * Envía la factura por email al cliente.
   */
  async sendInvoiceByEmail(invoiceId, emails) {
    return this._request('POST', `/invoices/${invoiceId}/email`, {
      emails: Array.isArray(emails) ? emails : [emails],
    });
  }

  /**
   * Anula una factura de venta.
   */
  async voidInvoice(invoiceId) {
    return this._request('POST', `/invoices/${invoiceId}/void`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NOTAS CRÉDITO (Para devoluciones/anulaciones)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Crea una nota crédito asociada a una factura.
   * 
   * @param {object} creditNote
   * @param {string} creditNote.date - Fecha
   * @param {object} creditNote.client - { id }
   * @param {Array} creditNote.items - [{ id, price, quantity }]
   * @param {Array} creditNote.invoices - [{ id: invoiceId }]
   * @param {string} [creditNote.cause] - Razón: 'RETURN', 'DISCOUNT', 'PRICE_ADJUSTMENT', etc.
   * @param {string} [creditNote.observations] - Notas
   */
  async createCreditNote(creditNote) {
    return this._request('POST', '/credit-notes', {
      date: creditNote.date,
      client: creditNote.client,
      items: creditNote.items,
      invoices: creditNote.invoices,
      // Colombia-specific
      cause: creditNote.cause || '1', // 1 = Devolución parcial, 2 = Anulación factura
      stamp: { generateStamp: true },
      observations: creditNote.observations || undefined,
    });
  }

  /**
   * Consulta una nota crédito.
   */
  async getCreditNote(creditNoteId) {
    return this._request('GET', `/credit-notes/${creditNoteId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // IMPUESTOS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Lista impuestos configurados en la cuenta.
   */
  async listTaxes() {
    return this._request('GET', '/taxes');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NUMERACIONES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Lista las numeraciones/resoluciones DIAN configuradas.
   */
  async listNumberTemplates() {
    return this._request('GET', '/number-templates');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // COMPANY INFO
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Obtiene información de la empresa (útil para verificar conexión).
   */
  async getCompanyInfo() {
    return this._request('GET', '/company');
  }
}

/**
 * Crea un cliente de Alegra configurado para un tenant.
 * 
 * @param {object} tenant - Objeto tenant con billing_provider, billing_api_key, etc.
 * @returns {AlegraClient|null}
 */
function createAlegraClientForTenant(tenant) {
  if (tenant.billing_provider !== 'alegra') return null;

  // billing_api_key almacena: "email:token" (separado por :)
  const [email, token] = (tenant.billing_api_key || '').split(':');
  if (!email || !token) {
    throw new Error('Credenciales de Alegra no configuradas. Formato esperado en billing_api_key: "email:token"');
  }

  return new AlegraClient(email, token);
}

module.exports = { AlegraClient, createAlegraClientForTenant };

// Método faltante referenciado en billing.sync.js
AlegraClient.prototype.updateItem = function(itemId, data) {
  return this._request('PUT', `/items/${itemId}`, data);
};
