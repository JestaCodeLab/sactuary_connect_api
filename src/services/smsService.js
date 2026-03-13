import axios from 'axios';
import SmsCredit from '../models/SmsCredit.js';
import SmsLog from '../models/SmsLog.js';
import Member from '../models/Member.js';
import Organization from '../models/Organization.js';
import logger from '../utils/logger.js';

class SMSService {
  constructor() {
    this.baseUrl = 'https://smsc.hubtel.com/v1/messages/send';
    this.clientId = process.env.HUBTEL_CLIENT_ID;
    this.clientSecret = process.env.HUBTEL_CLIENT_SECRET;
    this.senderId = process.env.HUBTEL_SENDER_ID || 'ZIONHILL';
  }

  /**
   * Calculate SMS credits needed
   */
  calculateCredits(message, recipientCount) {
    const messageLength = message.length;
    let segments = 1;

    if (messageLength <= 160) {
      segments = 1;
    } else {
      segments = Math.ceil(messageLength / 153);
    }

    return segments * recipientCount;
  }

  /**
   * Replace template variables with actual values
   * Example: "Hello {{memberName}}, thank you for {{amount}}" 
   * becomes "Hello John, thank you for 500"
   */
  replaceTemplateVariables(template, variables) {
    let message = template;

    Object.keys(variables).forEach(key => {
      const placeholder = `{{${key}}}`;
      const regex = new RegExp(placeholder, 'g');
      message = message.replace(regex, variables[key]);
    });

    return message;
  }

  /**
   * Check if merchant has sufficient credits
   */
  async checkCredits(merchantId, creditsNeeded) {
    const smsCredit = await SmsCredit.findOne({ merchantId });

    if (!smsCredit) {
      throw new Error('SMS credit account not found. Please contact support.');
    }

    const available = smsCredit.balance;
    const hasSufficient = available >= creditsNeeded;

    return {
      hasSufficient,
      available,
      needed: creditsNeeded,
      shortage: Math.max(0, creditsNeeded - available)
    };
  }

  /**
   * Get sender ID for merchant (dynamic sender ID support)
   */
  async getSenderId(merchantId) {
    try {
      const merchant = await Organization.findById(merchantId);

      if (!merchant) {
        logger.warn(`Organization ${merchantId} not found, using platform sender ID`);
        return this.senderId;
      }

      // ✅ EXPLICIT CHECKS with detailed logging
      const senderId = merchant.smsConfig?.senderId;
      const status = merchant.smsConfig?.senderIdStatus;

      logger.info(`[getSenderId] Organization: "${merchant.churchName || 'Unknown'}"`);
      logger.info(`[getSenderId] senderId value: "${senderId}" (type: ${typeof senderId})`);
      logger.info(`[getSenderId] status value: "${status}" (type: ${typeof status})`);
      logger.info(`[getSenderId] Full smsConfig: ${JSON.stringify(merchant.smsConfig)}`);

      // ✅ ONLY USE CUSTOM SENDER ID IF:
      // 1. senderId exists and is not null/empty
      // 2. status is EXACTLY the string 'approved'
      if (senderId && status === 'approved') {
        logger.info(`✅ [APPROVED] Using custom sender ID "${senderId}" for organization "${merchant.churchName || 'Unknown'}"`);
        return senderId;
      }

      // Fallback to platform sender ID
      const platformSenderId = this.senderId;
      logger.warn(`⚠️  [FALLBACK TO PLATFORM] Organization "${merchant.churchName || 'Unknown'}" - senderId: ${senderId ? '✓ exists' : '✗ missing'}, status: "${status}"`);

      return platformSenderId;

    } catch (error) {
      logger.error(`Error getting sender ID for merchant ${merchantId}: ${error.message}`);
      logger.error(error.stack);
      return this.senderId;
    }
  }

  /**
   * Process template with variables
   */
  processTemplate(template, variables) {
    let message = template;

    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      message = message.replace(regex, variables[key] || '');
    });

    return message;
  }

  /**
   * Process template with member-specific variables
   */
  async processTemplateForMember(template, member, merchant, additionalVars = {}) {
    const variables = {
      firstName: member.firstName || '',
      lastName: member.lastName || '',
      fullName: `${member.firstName || ''} ${member.lastName || ''}`.trim(),
      churchName: merchant?.churchName || '',
      churchPhone: merchant?.phone || '',
      churchEmail: merchant?.email || '',
      date: new Date().toLocaleDateString(),
      time: new Date().toLocaleTimeString(),
      ...additionalVars
    };

    let message = template;
    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      message = message.replace(regex, variables[key] || '');
    });

    return message;
  }

  /**
   * Format phone number for Hubtel
   * Accepts: 233XXXXXXXXX or 0XXXXXXXXX
   */
  formatPhoneNumber(phone) {
    if (!phone) return '';

    let cleaned = phone.replace(/\D/g, '');

    // If starts with 0 and is 10 digits (local format)
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      return '233' + cleaned.substring(1); // Convert to international
    }

    // If starts with 233 and is 12 digits (international format)
    if (cleaned.startsWith('233') && cleaned.length === 12) {
      return cleaned;
    }

    // If neither, add 233
    if (!cleaned.startsWith('0') && !cleaned.startsWith('233')) {
      cleaned = '233' + cleaned;
    }

    return cleaned;
  }

  /**
   * Validate Hubtel credentials
   */
  validateCredentials() {
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Hubtel credentials not configured. Please set HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET in .env');
    }
  }

  /**
   * Send SMS to single recipient via Hubtel
   */
  async sendSingle({
    phone,
    message,
    merchantId,
    userId,
    category = 'general',
    templateId = null,
    metadata = {},
    clientId = null,              // ✅ NEW - optional merchant-specific credentials
    clientSecret = null,          // ✅ NEW - optional merchant-specific credentials
    usePlatformCredentials = false // ✅ NEW - force platform credentials for super admin
  }) {
    try {
      // ✅ NEW: Use merchant credentials if provided, otherwise use platform credentials
      const effectiveClientId = clientId || this.clientId;
      const effectiveClientSecret = clientSecret || this.clientSecret;

      // ✅ DEBUG: Log which credentials are being used
      if (usePlatformCredentials) {
        logger.info(`🔐 [SUPER ADMIN] Using platform Hubtel credentials (clientId: ${this.clientId.substring(0, 4)}...)`);
      } else if (clientId && clientSecret) {
        logger.info(`🔐 [MERCHANT CREDENTIALS] Using merchant's Hubtel credentials (clientId: ${clientId.substring(0, 4)}...)`);
      } else {
        logger.info(`🔐 [PLATFORM CREDENTIALS] Using platform Hubtel credentials (clientId: ${this.clientId.substring(0, 4)}...)`);
      }

      if (!effectiveClientId || !effectiveClientSecret) {
        throw new Error('SMS credentials not configured. Please set HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET in .env');
      }

      // Validate phone number exists
      if (!phone || typeof phone !== 'string') {
        throw new Error(`Invalid phone number: ${phone}. Phone number must be a non-empty string.`);
      }

      // ✅ For super admin, always use platform sender ID
      const senderId = usePlatformCredentials ? this.senderId : await this.getSenderId(merchantId);
      const formattedPhone = this.formatPhoneNumber(phone);

      // Validate formatted phone
      if (!formattedPhone) {
        throw new Error(`Failed to format phone number: ${phone}. Please ensure it's a valid phone number.`);
      }

      // Calculate credits needed
      const creditsNeeded = this.calculateCredits(message, 1);

      // Check credits
      const creditCheck = await this.checkCredits(merchantId, creditsNeeded);
      if (!creditCheck.hasSufficient) {
        throw new Error(`Insufficient SMS credits. You need ${creditCheck.shortage} more credits.`);
      }

      // Create SMS log with PENDING status
      const smsLog = await SmsLog.create({
        merchantId,
        sentBy: userId,
        messageType: 'single',
        category,
        recipients: [{
          phoneNumber: formattedPhone,
          status: 'pending',
          name: metadata.recipientName || null,
          memberId: metadata.memberId || null
        }],
        message,
        senderID: senderId,
        templateUsed: templateId,
        creditsUsed: creditsNeeded,
        overallStatus: 'pending',
        totalRecipients: 1,
        metadata: metadata
      });

      logger.info(`📤 Sending SMS to ${formattedPhone} via Hubtel using Sender-ID: "${senderId}"`);

      // ✅ GET request with query parameters using effective credentials
      const url = `${this.baseUrl}?clientid=${encodeURIComponent(effectiveClientId)}&clientsecret=${encodeURIComponent(effectiveClientSecret)}&from=${encodeURIComponent(senderId)}&to=${encodeURIComponent(formattedPhone)}&content=${encodeURIComponent(message)}&registereddelivery=true`;

      logger.info(`📋 SMS Request - Sender-ID: ${senderId}, Recipient: ${formattedPhone}`);

      // Send via Hubtel
      const response = await axios.get(url, {
        timeout: 30000
      });

      logger.info(`Hubtel response: ${JSON.stringify(response.data)}`);

      /**
       * ✅ HUBTEL ACTUAL RESPONSE FORMAT:
       * {
       *   "rate": 0.05,
       *   "messageId": "7cefbe53-2768-47ed-9aa0-e433b387bebd",
       *   "status": 0,  // ✅ Number 0 = success (lowercase 's')
       *   "statusDescription": null,
       *   "networkId": ""
       * }
       * 
       * Status codes:
       * 0 = Success
       * 1 = Invalid credentials
       * 2 = Invalid phone number
       * 3 = Insufficient balance
       */

      // ✅ FIXED: Use lowercase 'status' and 'messageId', check number 0
      const statusCode = response.data?.status;
      const isSuccess = statusCode === 0 || statusCode === "0";
      const messageId = response.data?.messageId;

      if (isSuccess) {
        // Message accepted by Hubtel
        smsLog.recipients[0].status = 'submitted';
        smsLog.recipients[0].sentAt = new Date();
        smsLog.recipients[0].hubtelMessageId = messageId;
        smsLog.recipients[0].deliveryReport = JSON.stringify({
          messageId: messageId,
          rate: response.data?.rate,
          networkId: response.data?.networkId,
          statusDescription: response.data?.statusDescription
        });
        smsLog.overallStatus = 'submitted';

        await smsLog.save();

        // Deduct credits
        const smsCredit = await SmsCredit.findOne({ merchantId });
        if (smsCredit) {
          await smsCredit.deductCredits(creditsNeeded);
          logger.info(`💳 Deducted ${creditsNeeded} credits from merchant ${merchantId}`);
        }

        logger.info(`✅ SMS submitted to Hubtel. Message ID: ${messageId}`);

        // ✅ START IMMEDIATE POLLING
        try {
          const deliveryPoller = require('./smsDeliveryPoller');
          setImmediate(() => {
            deliveryPoller.pollAfterSend(smsLog._id.toString())
              .catch(error => {
                logger.error(`Polling error for SMS ${smsLog._id}: ${error.message}`);
              });
          });
          logger.info(`🔄 Started immediate delivery tracking for SMS ${smsLog._id}`);
        } catch (pollerError) {
          logger.warn(`⚠️  Poller not available: ${pollerError.message}`);
        }

      } else {
        // Message rejected
        const errorMessages = {
          1: 'Invalid Hubtel credentials',
          2: 'Invalid phone number format',
          3: 'Insufficient Hubtel account balance',
          4: 'Invalid sender ID or not registered'
        };

        const errorMessage = errorMessages[statusCode] ||
          response.data?.statusDescription ||
          `Hubtel error (status: ${statusCode})`;

        smsLog.recipients[0].status = 'failed';
        smsLog.recipients[0].failureReason = errorMessage;
        smsLog.overallStatus = 'failed';
        smsLog.failedDeliveries = 1;
        smsLog.errors.push({
          message: errorMessage,
          code: statusCode,
          timestamp: new Date(),
          response: JSON.stringify(response.data)
        });

        await smsLog.save();

        logger.error(`❌ SMS rejected by Hubtel: ${errorMessage}`);
      }

      return {
        success: isSuccess,
        smsLog: smsLog,
        creditsUsed: isSuccess ? creditsNeeded : 0,
        status: isSuccess ? 'submitted' : 'failed',
        messageId: messageId,
        providerResponse: response.data
      };

    } catch (error) {
      logger.error(`❌ Hubtel SMS send error: ${error.message}`);

      // Handle specific HTTP errors
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data;

        logger.error(`Hubtel API Error (${status}): ${JSON.stringify(errorData)}`);

        if (status === 401 || status === 403) {
          throw new Error('Hubtel authentication failed. Please check HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET.');
        } else if (status === 400) {
          throw new Error(`Invalid request: ${errorData?.Message || 'Check phone number and message content'}`);
        }

        throw new Error(errorData?.Message || error.message);
      }

      throw error;
    }
  }

  /**
   * Send SMS to single recipient without deducting credits (FREE)
   * Used for system notifications like donation receipts that shouldn't charge merchants
   */
  async sendSingleFree({
    phone,
    message,
    category = 'thank_you',
    metadata = {}
  }) {
    try {
      this.validateCredentials();

      const formattedPhone = this.formatPhoneNumber(phone);
      const senderId = this.senderId; // Use platform sender ID only

      // Create SMS log without checking/deducting credits
      // Use a valid ObjectId for system merchant (won't deduct credits)
      const mongoose = require('mongoose');
      const systemMerchantId = new mongoose.Types.ObjectId('000000000000000000000001');

      // Ensure category is valid
      const validCategories = [
        'welcome',
        'event_reminder',
        'event_confirmation',
        'birthday',
        'anniversary',
        'first_timer_followup',
        'announcement',
        'invitation',
        'thank_you',
        'general',
        'event',
        'reminder',
        'emergency',
        'other'
      ];
      const finalCategory = validCategories.includes(category) ? category : 'thank_you';

      // Create SMS log without checking/deducting credits
      const smsLog = await SmsLog.create({
        merchantId: systemMerchantId, // Use system merchant ID
        sentBy: null,
        messageType: 'single',
        category: finalCategory,
        recipients: [{
          phoneNumber: formattedPhone,
          status: 'pending',
          name: metadata.recipientName || null
        }],
        message,
        senderID: senderId,
        creditsUsed: 0, // No credits charged
        overallStatus: 'pending',
        totalRecipients: 1,
        metadata: { ...metadata, isFreeMessage: true }
      });

      logger.info(`📤 Sending FREE SMS to ${formattedPhone} via Hubtel (no credits charged)...`);

      // ✅ GET request with query parameters
      const url = `${this.baseUrl}?clientid=${encodeURIComponent(this.clientId)}&clientsecret=${encodeURIComponent(this.clientSecret)}&from=${encodeURIComponent(senderId)}&to=${encodeURIComponent(formattedPhone)}&content=${encodeURIComponent(message)}&registereddelivery=true`;

      // Send via Hubtel
      const response = await axios.get(url, {
        timeout: 30000
      });

      const statusCode = response.data?.status;
      const isSuccess = statusCode === 0 || statusCode === "0";
      const messageId = response.data?.messageId;

      if (isSuccess) {
        // Message accepted by Hubtel
        smsLog.recipients[0].status = 'submitted';
        smsLog.recipients[0].sentAt = new Date();
        smsLog.recipients[0].hubtelMessageId = messageId;
        smsLog.recipients[0].deliveryReport = JSON.stringify({
          messageId: messageId,
          rate: response.data?.rate,
          networkId: response.data?.networkId,
          statusDescription: response.data?.statusDescription
        });
        smsLog.overallStatus = 'submitted';

        await smsLog.save();

        logger.info(`✅ FREE SMS submitted to Hubtel. Message ID: ${messageId}`);

        // START IMMEDIATE POLLING
        try {
          const deliveryPoller = require('./smsDeliveryPoller');
          setImmediate(() => {
            deliveryPoller.pollAfterSend(smsLog._id.toString())
              .catch(error => {
                logger.error(`Polling error for FREE SMS ${smsLog._id}: ${error.message}`);
              });
          });
          logger.info(`🔄 Started immediate delivery tracking for FREE SMS ${smsLog._id}`);
        } catch (pollerError) {
          logger.warn(`⚠️  Poller not available: ${pollerError.message}`);
        }

      } else {
        // Message rejected
        const errorMessages = {
          1: 'Invalid Hubtel credentials',
          2: 'Invalid phone number format',
          3: 'Insufficient Hubtel account balance',
          4: 'Invalid sender ID or not registered'
        };

        const errorMessage = errorMessages[statusCode] ||
          response.data?.statusDescription ||
          `Hubtel error (status: ${statusCode})`;

        smsLog.recipients[0].status = 'failed';
        smsLog.recipients[0].failureReason = errorMessage;
        smsLog.overallStatus = 'failed';
        smsLog.failedDeliveries = 1;
        smsLog.errors.push({
          message: errorMessage,
          code: statusCode,
          timestamp: new Date(),
          response: JSON.stringify(response.data)
        });

        await smsLog.save();

        logger.error(`❌ FREE SMS rejected by Hubtel: ${errorMessage}`);
      }

      return {
        success: isSuccess,
        smsLog: smsLog,
        creditsUsed: 0, // Always 0 for free messages
        status: isSuccess ? 'submitted' : 'failed',
        messageId: messageId,
        providerResponse: response.data
      };

    } catch (error) {
      logger.error(`❌ Hubtel FREE SMS send error: ${error.message}`);

      // Handle specific HTTP errors
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data;

        logger.error(`Hubtel API Error (${status}): ${JSON.stringify(errorData)}`);

        if (status === 401 || status === 403) {
          throw new Error('Hubtel authentication failed. Please check HUBTEL_CLIENT_ID and HUBTEL_CLIENT_SECRET.');
        } else if (status === 400) {
          throw new Error(`Invalid request: ${errorData?.Message || 'Check phone number and message content'}`);
        }

        throw new Error(errorData?.Message || error.message);
      }

      throw error;
    }
  }

  /**
   * Send bulk SMS via Hubtel
   */
  async sendBulk({
    phones,
    message,
    merchantId,
    userId,
    category = 'general',
    templateId = null,
    metadata = {},
    clientId = null,      // ✅ NEW - optional merchant-specific credentials
    clientSecret = null   // ✅ NEW - optional merchant-specific credentials
  }) {
    try {
      // ✅ NEW: Use merchant credentials if provided, otherwise use platform credentials
      const effectiveClientId = clientId || this.clientId;
      const effectiveClientSecret = clientSecret || this.clientSecret;

      // ✅ DEBUG: Log which credentials are being used
      if (clientId && clientSecret) {
        logger.info(`🔐 [MERCHANT CREDENTIALS] Using merchant's Hubtel credentials for bulk SMS (clientId: ${clientId.substring(0, 4)}...)`);
      } else {
        logger.info(`🔐 [PLATFORM CREDENTIALS] Using platform Hubtel credentials for bulk SMS (clientId: ${this.clientId.substring(0, 4)}...)`);
      }

      this.validateCredentials();

      if (!phones || !Array.isArray(phones) || phones.length === 0) {
        throw new Error('Valid phone numbers array is required');
      }

      if (phones.length > 1000) {
        throw new Error('Maximum 1000 recipients allowed per bulk send');
      }

      const senderId = await this.getSenderId(merchantId);
      const formattedPhones = phones.map(p => this.formatPhoneNumber(p));

      // ⚠️ IMPORTANT: Only remove duplicates if we DON'T have personalization data
      // If we have personalization data, each phone MUST correspond to its metadata (firstName, lastName)
      const hasMetadataWithNames = metadata.firstNames && metadata.lastNames &&
        Array.isArray(metadata.firstNames) &&
        Array.isArray(metadata.lastNames);

      // If we have personalization data, keep all phones as-is to maintain 1:1 correspondence with metadata
      const uniquePhones = hasMetadataWithNames ? formattedPhones : [...new Set(formattedPhones)];

      logger.info(`📤 Bulk SMS to ${uniquePhones.length} recipients via Hubtel using Sender-ID: "${senderId}"`);
      logger.info(`   Deduplicated: ${!hasMetadataWithNames} (keeping personalization correspondence)`);

      // Get merchant name for variable substitution
      const merchant = await Organization.findById(merchantId);
      const merchantName = merchant?.churchName || 'our church';

      // Debug logging for metadata
      logger.info(`📦 Metadata received:`, {
        hasFirstNames: !!metadata.firstNames,
        firstNamesLength: metadata.firstNames?.length,
        hasLastNames: !!metadata.lastNames,
        lastNamesLength: metadata.lastNames?.length,
        uniquePhonesLength: uniquePhones.length,
        hasMetadataWithNames: hasMetadataWithNames
      });

      // Check if we have personalization data
      const hasPersonalization = metadata.firstNames && metadata.lastNames &&
        Array.isArray(metadata.firstNames) && Array.isArray(metadata.lastNames) &&
        metadata.firstNames.length === uniquePhones.length &&
        metadata.lastNames.length === uniquePhones.length;

      logger.info(`🎯 Has personalization: ${hasPersonalization}`);
      if (hasPersonalization) {
        logger.info(`   First names: ${metadata.firstNames.join(', ')}`);
        logger.info(`   Last names: ${metadata.lastNames.join(', ')}`);
      }

      // Build personalized messages for each recipient if we have their data
      const personalizedMessages = [];
      if (hasPersonalization) {
        logger.info(`📝 Building personalized messages for ${uniquePhones.length} recipients`);
        for (let i = 0; i < uniquePhones.length; i++) {
          const variables = {
            firstName: metadata.firstNames[i] || '',
            lastName: metadata.lastNames[i] || '',
            churchName: merchantName
          };
          logger.info(`  Recipient ${i + 1}: ${variables.firstName} ${variables.lastName}`);
          const personalizedMsg = this.processTemplateVariables(message, variables);
          personalizedMessages.push({
            phone: uniquePhones[i],
            message: personalizedMsg
          });
        }
      } else {
        logger.info(`📋 No personalization data - using standard template variables only`);
        // Process template variables with only churchName
        const baseVariables = {
          churchName: merchantName
        };
        const processedMessage = this.processTemplateVariables(message, baseVariables);
        for (let i = 0; i < uniquePhones.length; i++) {
          personalizedMessages.push({
            phone: uniquePhones[i],
            message: processedMessage
          });
        }
      }

      // For credit calculation, use the first personalized message as reference
      const creditsNeeded = this.calculateCredits(personalizedMessages[0].message, uniquePhones.length);

      // Check credits
      const creditCheck = await this.checkCredits(merchantId, creditsNeeded);
      if (!creditCheck.hasSufficient) {
        throw new Error(`Insufficient SMS credits. You need ${creditCheck.shortage} more credits.`);
      }

      // Create recipients array
      const recipients = uniquePhones.map((phone, index) => ({
        phoneNumber: phone,
        status: 'pending',
        name: metadata.recipientNames?.[index] || null,
        memberId: metadata.memberIds?.[index] || null
      }));

      // Create SMS log (store the template message, not personalized ones)
      const smsLog = await SmsLog.create({
        merchantId,
        sentBy: userId,
        messageType: 'bulk',
        category,
        recipients,
        message: message,  // Store original template for reference
        senderID: senderId,
        templateUsed: templateId,
        creditsUsed: creditsNeeded,
        overallStatus: 'processing',
        totalRecipients: uniquePhones.length,
        metadata: metadata,
        isPersonalized: hasPersonalization
      });

      logger.info(`Created SMS log ${smsLog._id} for ${uniquePhones.length} recipients (personalized: ${hasPersonalization})`);

      try {
        // Send in batches of 50 (to avoid rate limiting)
        const batchSize = 50;
        const batches = [];

        for (let i = 0; i < uniquePhones.length; i += batchSize) {
          batches.push(uniquePhones.slice(i, i + batchSize));
        }

        logger.info(`📦 Splitting into ${batches.length} batches of ${batchSize}`);

        let successCount = 0;
        let failCount = 0;

        // Process batches sequentially
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          logger.info(`📤 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} recipients)...`);

          // Send all messages in this batch in parallel
          const sendPromises = batch.map(async (phone, index) => {
            const globalIndex = batchIndex * batchSize + index;
            const personalizedMsg = personalizedMessages[globalIndex]?.message || personalizedMessages[0].message;

            try {
              // ✅ GET request with query parameters using effective credentials
              const url = `${this.baseUrl}?clientid=${encodeURIComponent(effectiveClientId)}&clientsecret=${encodeURIComponent(effectiveClientSecret)}&from=${encodeURIComponent(senderId)}&to=${encodeURIComponent(phone)}&content=${encodeURIComponent(personalizedMsg)}&registereddelivery=true`;

              const response = await axios.get(url, {
                timeout: 30000
              });

              // ✅ FIXED: Use lowercase 'status' and 'messageId'
              const isSuccess = response.data?.status === 0 || response.data?.status === "0";

              return {
                phone,
                index: globalIndex,
                success: isSuccess,
                messageId: response.data?.messageId,
                response: response.data
              };
            } catch (error) {
              logger.error(`Failed to send to ${phone}: ${error.message}`);
              return {
                phone,
                index: globalIndex,
                success: false,
                error: error.response?.data?.Message || error.message
              };
            }
          });

          // Wait for this batch to complete
          const batchResults = await Promise.all(sendPromises);

          // Update recipients based on results
          batchResults.forEach(result => {
            const recipient = smsLog.recipients[result.index];

            if (result.success) {
              recipient.status = 'submitted';
              recipient.sentAt = new Date();
              recipient.hubtelMessageId = result.messageId;
              recipient.deliveryReport = JSON.stringify(result.response);
              successCount++;
            } else {
              recipient.status = 'failed';
              recipient.failureReason = result.error || 'Send failed';
              failCount++;
            }
          });

          // Save progress after each batch
          await smsLog.save();

          // Small delay between batches to avoid rate limiting
          if (batchIndex < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
          }
        }

        // Update overall status
        if (successCount === uniquePhones.length) {
          smsLog.overallStatus = 'submitted';
        } else if (failCount === uniquePhones.length) {
          smsLog.overallStatus = 'failed';
        } else {
          smsLog.overallStatus = 'partial';
        }

        // Deduct credits only for successful sends
        if (successCount > 0) {
          const actualCreditsUsed = this.calculateCredits(message, successCount);
          const smsCredit = await SmsCredit.findOne({ merchantId });
          if (smsCredit) {
            await smsCredit.deductCredits(actualCreditsUsed);
            logger.info(`💳 Deducted ${actualCreditsUsed} credits for ${successCount} successful sends`);
          }

          smsLog.creditsUsed = actualCreditsUsed;
        }

        await smsLog.save();

        logger.info(`✅ Bulk SMS completed: ${successCount} succeeded, ${failCount} failed`);

        // ✅ START IMMEDIATE POLLING
        try {
          const deliveryPoller = require('./smsDeliveryPoller');
          setImmediate(() => {
            deliveryPoller.pollAfterSend(smsLog._id.toString())
              .catch(error => {
                logger.error(`Polling error for bulk SMS ${smsLog._id}: ${error.message}`);
              });
          });
          logger.info(`🔄 Started immediate delivery tracking for bulk SMS ${smsLog._id}`);
        } catch (pollerError) {
          logger.warn(`⚠️  Poller not available: ${pollerError.message}`);
        }

        return {
          success: successCount > 0,
          smsLog: smsLog,
          recipientCount: uniquePhones.length,
          successCount: successCount,
          failCount: failCount,
          creditsUsed: smsLog.creditsUsed,
          status: smsLog.overallStatus
        };

      } catch (apiError) {
        logger.error(`Hubtel bulk API error: ${apiError.message}`);

        smsLog.recipients.forEach(recipient => {
          if (recipient.status === 'pending') {
            recipient.status = 'failed';
            recipient.failureReason = `API Error: ${apiError.message}`;
          }
        });

        smsLog.overallStatus = 'failed';
        smsLog.errors.push({
          message: `API Error: ${apiError.message}`,
          timestamp: new Date()
        });

        await smsLog.save();
        throw apiError;
      }

    } catch (error) {
      logger.error(`❌ Hubtel bulk SMS send error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send to members with template support
   */
  async sendToMembers({
    memberIds,
    message,
    merchantId,
    userId,
    category = 'general',
    templateId = null,
    clientId = null,      // ✅ NEW - optional merchant-specific credentials
    clientSecret = null,  // ✅ NEW - optional merchant-specific credentials
    branchId = null
  }) {
    try {
      // Get members
      const memberFilter = {
        _id: { $in: memberIds },
        organizationId: merchantId,
        phone: { $exists: true, $ne: '' }
      };
      if (branchId) memberFilter.branchId = branchId;
      const members = await Member.find(memberFilter).select('phone firstName lastName');

      if (members.length === 0) {
        throw new Error('No valid phone numbers found for selected members');
      }

      // Get merchant for church variables
      const merchant = await Organization.findById(merchantId);

      // Get template if provided
      let template = message;
      if (templateId) {
        const SmsTemplate = require('../models/sms/SmsTemplate');
        const smsTemplate = await SmsTemplate.findById(templateId);
        if (smsTemplate) {
          template = smsTemplate.message;
        }
      }

      // ✅ Process template for each member
      const personalizedMessages = await Promise.all(
        members.map(async (member) => {
          const personalizedMessage = await this.processTemplateForMember(
            template,
            member,
            merchant
          );

          return {
            phone: member.phone,
            message: personalizedMessage,
            memberId: member._id,
            memberName: `${member.firstName} ${member.lastName}`
          };
        })
      );

      // Send each personalized message
      const results = [];
      for (const item of personalizedMessages) {
        try {
          const result = await this.sendSingle({
            phone: item.phone,
            message: item.message,
            merchantId,
            userId,
            category,
            templateId,
            metadata: {
              memberId: item.memberId,
              recipientName: item.memberName
            },
            // ✅ NEW: Pass merchant credentials if available
            ...(clientId && clientSecret && { clientId, clientSecret })
          });
          results.push(result);
        } catch (error) {
          logger.error(`Failed to send to ${item.phone}: ${error.message}`);
          results.push({ success: false, error: error.message });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;

      return {
        success: successCount > 0,
        recipientCount: members.length,
        successCount,
        failCount,
        creditsUsed: results.reduce((sum, r) => sum + (r.creditsUsed || 0), 0),
        results
      };

    } catch (error) {
      logger.error(`Send to members error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send to department members
   */
  async sendToDepartment({ departmentId, message, merchantId, userId, category = 'general', templateId = null, clientId = null, clientSecret = null, branchId = null }) {
    try {
      const deptMemberFilter = {
        organizationId: merchantId,
        departments: departmentId,
        status: 'active',
        phone: { $exists: true, $ne: '' }
      };
      if (branchId) deptMemberFilter.branchId = branchId;
      const members = await Member.find(deptMemberFilter).select('phone firstName lastName');

      if (members.length === 0) {
        throw new Error('No members found in this department with valid phone numbers');
      }

      const phones = members.map(m => m.phone);
      const memberIdsArray = members.map(m => m._id);
      const recipientNames = members.map(m => `${m.firstName} ${m.lastName}`);
      const firstNames = members.map(m => m.firstName || '');
      const lastNames = members.map(m => m.lastName || '');

      const result = await this.sendBulk({
        phones,
        message,
        merchantId,
        userId,
        category,
        templateId,
        metadata: {
          departmentId,
          memberIds: memberIdsArray,
          recipientNames: recipientNames,
          firstNames: firstNames,
          lastNames: lastNames,
          targetGroup: 'department'
        },
        // ✅ NEW: Pass merchant credentials if available
        ...(clientId && clientSecret && { clientId, clientSecret })
      });

      const smsLog = await SmsLog.findById(result.smsLog._id);
      smsLog.targetGroup = 'department';
      smsLog.targetGroupDetails = { departmentId };
      await smsLog.save();

      return result;

    } catch (error) {
      logger.error(`Send to department error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send to branch members
   */
  async sendToBranch({ branchId, message, merchantId, userId, category = 'general', templateId = null, clientId = null, clientSecret = null }) {
    try {
      const members = await Member.find({
        organizationId: merchantId,
        branchId: branchId,
        status: 'active',
        phone: { $exists: true, $ne: '' }
      }).select('phone firstName lastName');

      if (members.length === 0) {
        throw new Error('No members found in this branch with valid phone numbers');
      }

      const phones = members.map(m => m.phone);
      const memberIdsArray = members.map(m => m._id);
      const recipientNames = members.map(m => `${m.firstName} ${m.lastName}`);
      const firstNames = members.map(m => m.firstName || '');
      const lastNames = members.map(m => m.lastName || '');

      const result = await this.sendBulk({
        phones,
        message,
        merchantId,
        userId,
        category,
        templateId,
        metadata: {
          branchId,
          memberIds: memberIdsArray,
          recipientNames: recipientNames,
          firstNames: firstNames,
          lastNames: lastNames,
          targetGroup: 'branch'
        },
        // ✅ NEW: Pass merchant credentials if available
        ...(clientId && clientSecret && { clientId, clientSecret })
      });

      const smsLog = await SmsLog.findById(result.smsLog._id);
      smsLog.targetGroup = 'branch';
      smsLog.targetGroupDetails = { branchId };
      await smsLog.save();

      return result;

    } catch (error) {
      logger.error(`Send to branch error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Send to all members
   */
  async sendToAllMembers({ message, merchantId, userId, category = 'general', templateId = null, clientId = null, clientSecret = null, branchId = null }) {
    try {
      const memberFilter = {
        organizationId: merchantId,
        status: 'active',
        phone: { $exists: true, $ne: '' }
      };
      if (branchId) memberFilter.branchId = branchId;

      const members = await Member.find(memberFilter).select('phone firstName lastName');

      if (members.length === 0) {
        throw new Error('No members found with valid phone numbers');
      }

      const phones = members.map(m => m.phone);
      const memberIdsArray = members.map(m => m._id);
      const recipientNames = members.map(m => `${m.firstName} ${m.lastName}`);
      const firstNames = members.map(m => m.firstName || '');
      const lastNames = members.map(m => m.lastName || '');

      const result = await this.sendBulk({
        phones,
        message,
        merchantId,
        userId,
        category,
        templateId,
        metadata: {
          memberIds: memberIdsArray,
          recipientNames: recipientNames,
          firstNames: firstNames,
          lastNames: lastNames,
          targetGroup: 'all_members'
        },
        // ✅ NEW: Pass merchant credentials if available
        ...(clientId && clientSecret && { clientId, clientSecret })
      });

      const smsLog = await SmsLog.findById(result.smsLog._id);
      smsLog.targetGroup = 'all_members';
      await smsLog.save();

      return result;

    } catch (error) {
      logger.error(`Send to all members error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process template variables in a message
   * Replaces {{variable}} with actual values
   */
  processTemplateVariables(message, variables = {}) {
    let processedMessage = message;

    // Replace all variables in the format {{variableName}}
    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      processedMessage = processedMessage.replace(regex, variables[key] || '');
    });

    // Remove any unreplaced variables (leave them blank)
    processedMessage = processedMessage.replace(/{{[^}]+}}/g, '');

    return processedMessage;
  }

  /**
   * Get recipient data for variable replacement
   * @param {string} recipientType - 'member', 'guest', or 'bulk'
   * @param {object} recipient - recipient data
   * @returns {object} variables object
   */
  getRecipientVariables(recipientType, recipient, merchantName) {
    const variables = {
      churchName: merchantName || 'our church'
    };

    if (recipientType === 'member' && recipient.member) {
      variables.firstName = recipient.member.firstName || '';
      variables.lastName = recipient.member.lastName || '';
    } else if (recipientType === 'guest' && recipient.partner) {
      variables.firstName = recipient.partner.firstName || '';
      variables.lastName = recipient.partner.lastName || '';
    } else if (recipient.firstName) {
      variables.firstName = recipient.firstName || '';
      variables.lastName = recipient.lastName || '';
    }

    // Add event-related variables if provided
    if (recipient.eventName) variables.eventName = recipient.eventName;
    if (recipient.eventDate) variables.eventDate = recipient.eventDate;
    if (recipient.eventTime) variables.eventTime = recipient.eventTime;

    return variables;
  }

  /**
   * Send Registration Welcome SMS - Uses Platform Sender ID "THESAVIORS"
   * Used for: New church registration, Sender ID setup notification
   */
  async sendRegistrationSMS({
    phone,
    churchName,
    messageType = 'registration', // 'registration' or 'senderid'
    message = null // Optional custom message to override default message
  }) {
    try {
      this.validateCredentials();

      const formattedPhone = this.formatPhoneNumber(phone);
      const platformSenderId = 'THESAVIORS'; // Always use platform sender ID for registration

      // Use custom message if provided, otherwise use default based on messageType
      let smsMessage = message;
      if (!smsMessage) {
        if (messageType === 'registration') {
          // message should be to super admin about a new church registration
          smsMessage = `A new church has been registered: ${churchName}! Please review and activate the account. Thank you!`;
        } else if (messageType === 'senderid') {
          smsMessage = `Your Sender ID registration request for ${churchName} has been submitted. You'll receive confirmation once it's approved. Thank you!`;
        }
      }

      // Calculate credits needed
      const creditsNeeded = this.calculateCredits(smsMessage, 1);

      logger.info(`📤 Sending ${messageType} SMS to ${formattedPhone} using Platform Sender-ID: "${platformSenderId}"`);

      // ✅ GET request with query parameters
      const url = `${this.baseUrl}?clientid=${encodeURIComponent(this.clientId)}&clientsecret=${encodeURIComponent(this.clientSecret)}&from=${encodeURIComponent(platformSenderId)}&to=${encodeURIComponent(formattedPhone)}&content=${encodeURIComponent(smsMessage)}&registereddelivery=true`;

      logger.info(`📋 ${messageType.toUpperCase()} SMS Request - Sender-ID: ${platformSenderId}, Recipient: ${formattedPhone}`);

      // Send via Hubtel
      const response = await axios.get(url, {
        timeout: 30000
      });

      logger.info(`Hubtel response for ${messageType} SMS: ${JSON.stringify(response.data)}`);

      if (response.data?.status === 0 || response.data?.status === '0') {
        logger.info(`✅ ${messageType.toUpperCase()} SMS sent successfully to ${formattedPhone}`);
        return {
          success: true,
          message: `${messageType} SMS sent successfully`,
          messageId: response.data.messageId,
          phone: formattedPhone
        };
      } else {
        const errorDescription = response.data?.statusDescription || 'Unknown error';
        throw new Error(`Hubtel SMS send failed: ${errorDescription} (Status: ${response.data?.status})`);
      }

    } catch (error) {
      logger.error(`Send ${messageType} SMS error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check Hubtel account balance
   * Note: Balance check may use different endpoint
   */
  async checkBalance() {
    try {
      this.validateCredentials();

      logger.warn('Balance check endpoint not yet confirmed for GET API');

      return {
        success: false,
        message: 'Balance check not available with current API version'
      };

    } catch (error) {
      logger.error(`Check Hubtel balance error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check delivery status for a specific message from Hubtel
   * @param {string} messageId - Hubtel message ID
   * @param {string} clientId - Optional merchant-specific client ID
   * @param {string} clientSecret - Optional merchant-specific client secret
   * @returns {Promise<Object>} Delivery status information
   */
  async checkDeliveryStatus(messageId, clientId = null, clientSecret = null) {
    try {
      const effectiveClientId = clientId || this.clientId;
      const effectiveClientSecret = clientSecret || this.clientSecret;

      if (!effectiveClientId || !effectiveClientSecret) {
        throw new Error('Hubtel credentials not configured');
      }

      // Hubtel delivery status check endpoint
      const statusUrl = `https://api.hubtel.com/v1/messages/${messageId}`;

      const response = await axios.get(statusUrl, {
        auth: {
          username: effectiveClientId,
          password: effectiveClientSecret
        }
      });

      if (response.data) {
        return {
          success: true,
          messageId: response.data.MessageId || messageId,
          status: response.data.Status,
          networkId: response.data.NetworkId,
          rate: response.data.Rate,
          sentTime: response.data.Time,
          updateTime: response.data.UpdateTime,
          units: response.data.Units
        };
      }

      return {
        success: false,
        message: 'Unable to fetch delivery status'
      };

    } catch (error) {
      logger.error(`Check delivery status error for message ${messageId}: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update delivery status for all pending/submitted messages in a log
   * @param {string} logId - SMS Log ID
   * @returns {Promise<Object>} Update results
   */
  async updateDeliveryStatuses(logId) {
    try {
      const smsLog = await SmsLog.findById(logId);
      if (!smsLog) {
        throw new Error('SMS log not found');
      }

      // Get merchant credentials if available
      const merchant = await Organization.findById(smsLog.merchantId);
      const clientId = merchant?.smsConfig?.hubtelClientId;
      const clientSecret = merchant?.smsConfig?.hubtelClientSecret;

      let updatedCount = 0;
      const results = [];

      for (const recipient of smsLog.recipients) {
        // Only check messages that are pending or submitted
        if (['pending', 'submitted'].includes(recipient.status) && recipient.hubtelMessageId) {
          const statusInfo = await this.checkDeliveryStatus(
            recipient.hubtelMessageId,
            clientId,
            clientSecret
          );

          if (statusInfo.success) {
            // Map Hubtel status to our status
            let newStatus = recipient.status;
            if (statusInfo.status === 'DELIVERED' || statusInfo.status === 6) {
              newStatus = 'delivered';
              recipient.deliveredAt = new Date(statusInfo.updateTime || Date.now());
            } else if (statusInfo.status === 'UNDELIVERED' || statusInfo.status === 8) {
              newStatus = 'undelivered';
              recipient.failureReason = 'Message undelivered';
            } else if (statusInfo.status === 'SENT' || statusInfo.status === 1) {
              newStatus = 'submitted';
            } else if (statusInfo.status === 'FAILED') {
              newStatus = 'failed';
              recipient.failureReason = 'Delivery failed';
            }

            if (newStatus !== recipient.status) {
              recipient.status = newStatus;
              recipient.deliveryReport = JSON.stringify(statusInfo);
              updatedCount++;
            }

            results.push({
              phoneNumber: recipient.phoneNumber,
              oldStatus: recipient.status,
              newStatus: newStatus,
              updated: newStatus !== recipient.status
            });
          }
        }
      }

      if (updatedCount > 0) {
        // Update overall status
        const deliveredCount = smsLog.recipients.filter(r => r.status === 'delivered').length;
        const failedCount = smsLog.recipients.filter(r => ['failed', 'undelivered'].includes(r.status)).length;
        const pendingCount = smsLog.recipients.filter(r => ['pending', 'submitted'].includes(r.status)).length;

        if (pendingCount === 0) {
          smsLog.overallStatus = failedCount === 0 ? 'sent' : failedCount === smsLog.recipients.length ? 'failed' : 'partial';
        }

        await smsLog.save();
      }

      return {
        success: true,
        logId,
        totalRecipients: smsLog.recipients.length,
        updatedCount,
        results
      };

    } catch (error) {
      logger.error(`Update delivery statuses error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Batch update delivery statuses for multiple logs
   * @param {Array<string>} logIds - Array of SMS Log IDs
   * @returns {Promise<Object>} Batch update results
   */
  async batchUpdateDeliveryStatuses(logIds) {
    const results = [];
    for (const logId of logIds) {
      try {
        const result = await this.updateDeliveryStatuses(logId);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          logId,
          error: error.message
        });
      }
    }

    return {
      success: true,
      totalLogs: logIds.length,
      results
    };
  }
}

export default new SMSService();
