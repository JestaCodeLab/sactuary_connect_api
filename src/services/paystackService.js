import axios from 'axios';
import logger from '../utils/logger.js';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

const paystackApi = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

/**
 * Verify a Paystack transaction by reference
 * @param {string} reference - The transaction reference
 * @returns {object} { verified, data } where data contains amount, currency, customer, channel, etc.
 */
export async function verifyTransaction(reference) {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      throw new Error('PAYSTACK_SECRET_KEY is not configured');
    }

    const response = await paystackApi.get(`/transaction/verify/${encodeURIComponent(reference)}`);

    const { status, data } = response.data;

    if (!status || data.status !== 'success') {
      logger.warn(`Paystack verification failed for ref ${reference}: status=${data?.status}`);
      return {
        verified: false,
        data: data,
        message: data?.gateway_response || 'Transaction not successful',
      };
    }

    logger.info(`Paystack verified: ref=${reference}, amount=${data.amount}, channel=${data.channel}`);

    return {
      verified: true,
      data: {
        reference: data.reference,
        amount: data.amount, // in pesewas (smallest unit)
        currency: data.currency,
        channel: data.channel, // 'card' or 'mobile_money'
        paidAt: data.paid_at,
        customer: data.customer,
        authorization: data.authorization,
        gatewayResponse: data.gateway_response,
      },
    };
  } catch (error) {
    if (error.response) {
      logger.error(`Paystack verify error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
      throw new Error(error.response.data?.message || 'Paystack verification failed');
    }
    logger.error(`Paystack verify error: ${error.message}`);
    throw error;
  }
}

/**
 * Initialize a Paystack transaction (for server-side initialization)
 * @param {object} params
 * @param {string} params.email - Customer email
 * @param {number} params.amount - Amount in pesewas (GHS * 100)
 * @param {string} params.currency - Currency code (default: GHS)
 * @param {string} params.reference - Unique transaction reference
 * @param {string} [params.callback_url] - URL to redirect after payment
 * @param {object} [params.metadata] - Additional metadata
 * @param {string[]} [params.channels] - Payment channels to allow
 * @returns {object} { authorization_url, access_code, reference }
 */
export async function initializeTransaction({
  email,
  amount,
  currency = 'GHS',
  reference,
  callback_url,
  metadata,
  channels,
}) {
  try {
    if (!PAYSTACK_SECRET_KEY) {
      throw new Error('PAYSTACK_SECRET_KEY is not configured');
    }

    const payload = {
      email,
      amount, // already in pesewas
      currency,
      reference,
      ...(callback_url && { callback_url }),
      ...(metadata && { metadata }),
      ...(channels && { channels }),
    };

    const response = await paystackApi.post('/transaction/initialize', payload);

    const { data } = response.data;

    logger.info(`Paystack initialized: ref=${data.reference}, url=${data.authorization_url}`);

    return {
      authorization_url: data.authorization_url,
      access_code: data.access_code,
      reference: data.reference,
    };
  } catch (error) {
    if (error.response) {
      logger.error(`Paystack init error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
      throw new Error(error.response.data?.message || 'Failed to initialize payment');
    }
    logger.error(`Paystack init error: ${error.message}`);
    throw error;
  }
}

export default {
  verifyTransaction,
  initializeTransaction,
};
