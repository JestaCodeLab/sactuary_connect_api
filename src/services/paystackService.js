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

/**
 * Create a Paystack subaccount for merchant account setup
 * @param {object} financeAccountData - Finance account data from form submission
 * @returns {object} { success, paystackMerchantId, paystackAuthorizationUrl, liveMode, error }
 */
export async function createMerchantAccount(financeAccountData) {
  try {
    const {
      businessName,
      ownerFullName,
      ownerEmail,
      ownerPhone,
      bankAccountNumber,
      bankCode,
      businessAddress,
    } = financeAccountData;

    const payload = {
      business_name: businessName,
      settlement_bank: bankCode,
      account_number: bankAccountNumber,
      subaccount_code: null,
      integration_title: `${businessName} - Sanctuary Connect`,
      percentage_charge: 0.8, // Default commission
      description: `Merchant account for ${businessName}`,
      contact_name: ownerFullName,
      contact_email: ownerEmail,
      contact_phone: ownerPhone,
      business_address: businessAddress,
      business_mobile: ownerPhone,
      business_email: ownerEmail,
    };

    const response = await paystackApi.post('/subaccount', payload);

    if (response.data && response.data.status) {
      logger.info(`Paystack subaccount created: ${response.data.data.subaccount_code} for ${businessName}`);
      return {
        success: true,
        paystackMerchantId: response.data.data.subaccount_code,
        paystackAuthorizationUrl: response.data.data.authorization_url || null,
        liveMode: process.env.PAYSTACK_LIVE_MODE === 'true',
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
      error: error.message,
      details: error.response?.data || null,
    };
  }
}

/**
 * Verify bank account details
 * @param {string} bankCode - Bank code on Paystack
 * @param {string} accountNumber - Bank account number
 * @returns {object} { success, accountName, accountNumber, bankCode, error }
 */
export async function verifyBankAccount(bankCode, accountNumber) {
  try {
    const response = await paystackApi.get(
      `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`
    );

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
      error: error.message,
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
    const response = await paystackApi.get(`/bank?country=${country}&use_cursor=false`);

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
  createMerchantAccount,
  verifyBankAccount,
  listBanks,
};
