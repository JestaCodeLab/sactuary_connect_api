import axios from 'axios';
import logger from '../utils/logger.js';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function getClient(secretKey) {
  const key = secretKey || process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error('Paystack secret key is not configured');
  }
  return axios.create({
    baseURL: PAYSTACK_BASE_URL,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

/**
 * Verify a Paystack transaction by reference
 * @param {string} reference - The transaction reference
 * @param {string} [secretKey] - Merchant's own secret key; defaults to the platform key
 * @returns {object} { verified, data } where data contains amount, currency, customer, channel, metadata, etc.
 */
export async function verifyTransaction(reference, secretKey) {
  try {
    const client = getClient(secretKey);
    const response = await client.get(`/transaction/verify/${encodeURIComponent(reference)}`);

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
        metadata: data.metadata,
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
 * @param {string} [params.subaccount] - Paystack subaccount code to route settlement to
 * @param {string} [secretKey] - Merchant's own secret key; defaults to the platform key
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
  subaccount,
}, secretKey) {
  try {
    const client = getClient(secretKey);

    const payload = {
      email,
      amount, // already in pesewas
      currency,
      reference,
      ...(callback_url && { callback_url }),
      ...(metadata && { metadata }),
      ...(channels && { channels }),
      ...(subaccount && { subaccount }),
    };

    const response = await client.post('/transaction/initialize', payload);

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

/**
 * Create a Paystack subaccount under a merchant's own account (used both for
 * the org's primary settlement account historically, and now for individual
 * branch accounts created under the primary's own keys).
 * @param {object} params
 * @param {string} params.secretKey - The Paystack secret key to create the subaccount under (required)
 * @param {string} params.businessName
 * @param {string} params.bankCode
 * @param {string} params.accountNumber
 * @param {number} [params.percentageCharge] - Platform's cut for this subaccount (default 0)
 * @returns {object} { success, paystackSubaccountCode, error }
 */
export async function createPaystackSubaccount({
  secretKey,
  businessName,
  bankCode,
  accountNumber,
  percentageCharge = 0,
}) {
  try {
    if (!secretKey) {
      throw new Error('secretKey is required to create a Paystack subaccount');
    }

    const client = getClient(secretKey);
    const payload = {
      business_name: businessName,
      settlement_bank: bankCode,
      account_number: accountNumber,
      percentage_charge: percentageCharge,
    };

    const response = await client.post('/subaccount', payload);

    if (response.data && response.data.status) {
      logger.info(`Paystack subaccount created: ${response.data.data.subaccount_code} for ${businessName}`);
      return {
        success: true,
        paystackSubaccountCode: response.data.data.subaccount_code,
        rawResponse: response.data.data,
      };
    } else {
      logger.error(`Paystack subaccount creation failed: ${JSON.stringify(response.data)}`);
      return {
        success: false,
        error: 'Failed to create subaccount',
        details: response.data,
      };
    }
  } catch (error) {
    logger.error(`Error creating Paystack subaccount: ${error.response?.data?.message || error.message}`);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data || null,
    };
  }
}

/**
 * Lightweight validation that a secret key is a real, working Paystack key.
 * @param {string} secretKey
 * @returns {object} { valid, error }
 */
export async function verifyPaystackKey(secretKey) {
  try {
    const client = getClient(secretKey);
    await client.get('/bank', { params: { perPage: 1 } });
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error.response?.data?.message || 'Invalid or unreachable Paystack key',
    };
  }
}

/**
 * Verify bank account details
 * @param {string} bankCode - Bank code on Paystack
 * @param {string} accountNumber - Bank account number
 * @param {string} [secretKey] - Merchant's own secret key; defaults to the platform key
 * @returns {object} { success, accountName, accountNumber, bankCode, error }
 */
export async function verifyBankAccount(bankCode, accountNumber, secretKey) {
  try {
    const client = getClient(secretKey);
    const response = await client.get('/bank/resolve', {
      params: { account_number: accountNumber, bank_code: bankCode },
    });

    if (response.data && response.data.status) {
      logger.info(`Bank account verified: ${response.data.data.account_name}`);
      return {
        success: true,
        accountName: response.data.data.account_name,
        accountNumber: response.data.data.account_number,
        bankCode: response.data.data.bank_id,
      };
    } else {
      logger.warn(`Bank account verification failed for ${accountNumber}`);
      return {
        success: false,
        error: 'Invalid bank account details',
      };
    }
  } catch (error) {
    logger.error(`Error verifying bank account: ${error.response?.data?.message || error.message}`);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data || null,
    };
  }
}

/**
 * List all banks available on Paystack
 * @param {string} country - Country code (default: NG for Nigeria)
 * @returns {object} { success, banks, error }
 */
export async function listBanks(country = 'NG') {
  try {
    const client = getClient();
    const response = await client.get('/bank', { params: { country, use_cursor: false } });

    if (response.data && response.data.status) {
      logger.info(`Listed ${response.data.data.length} banks for ${country}`);
      return {
        success: true,
        banks: response.data.data,
      };
    } else {
      return {
        success: false,
        error: 'Failed to fetch banks',
      };
    }
  } catch (error) {
    logger.error(`Error listing banks: ${error.response?.data?.message || error.message}`);
    return {
      success: false,
      error: error.message,
      details: error.response?.data || null,
    };
  }
}

export default {
  verifyTransaction,
  initializeTransaction,
  createPaystackSubaccount,
  verifyPaystackKey,
  verifyBankAccount,
  listBanks,
};
