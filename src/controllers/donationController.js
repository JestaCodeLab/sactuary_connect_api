import Donation from '../models/Donation.js';

export const getAllDonations = async (req, res) => {
  try {
    const donations = await Donation.find()
      .populate('donorId', 'firstName lastName email')
      .populate('fundBucketId', 'name')
      .sort({ donationDate: -1 });
    res.json(donations);
  } catch (error) {
    console.error('Error fetching donations:', error);
    res.status(500).json({ error: 'Failed to fetch donations' });
  }
};

export const getDonationById = async (req, res) => {
  try {
    const { id } = req.params;
    const donation = await Donation.findById(id)
      .populate('donorId', 'firstName lastName email')
      .populate('fundBucketId', 'name');

    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    res.json(donation);
  } catch (error) {
    console.error('Error fetching donation:', error);
    res.status(500).json({ error: 'Failed to fetch donation' });
  }
};

export const createDonation = async (req, res) => {
  try {
    const { donorId, amount, donationType, donationDate, paymentMethod, transactionId, notes, fundBucketId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' });
    }

    const donation = new Donation({
      donorId,
      amount,
      donationType,
      donationDate,
      paymentMethod,
      transactionId,
      notes,
      fundBucketId,
    });

    await donation.save();
    res.status(201).json(donation);
  } catch (error) {
    console.error('Error creating donation:', error);
    res.status(500).json({ error: 'Failed to create donation' });
  }
};

export const updateDonation = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedAt: Date.now() };
    delete updates._id;

    const donation = await Donation.findByIdAndUpdate(id, updates, { new: true });

    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    res.json(donation);
  } catch (error) {
    console.error('Error updating donation:', error);
    res.status(500).json({ error: 'Failed to update donation' });
  }
};

export const getDonationStats = async (req, res) => {
  try {
    const stats = await Donation.aggregate([
      {
        $group: {
          _id: {
            donationType: '$donationType',
            month: { $dateToString: { format: '%Y-%m', date: '$donationDate' } },
          },
          totalDonations: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          averageDonation: { $avg: '$amount' },
          largestDonation: { $max: '$amount' },
        },
      },
      {
        $project: {
          _id: 0,
          donationType: '$_id.donationType',
          month: '$_id.month',
          totalDonations: 1,
          totalAmount: 1,
          averageDonation: { $round: ['$averageDonation', 2] },
          largestDonation: 1,
        },
      },
      { $sort: { month: -1 } },
    ]);

    res.json(stats);
  } catch (error) {
    console.error('Error fetching donation stats:', error);
    res.status(500).json({ error: 'Failed to fetch donation stats' });
  }
};

export default {
  getAllDonations,
  getDonationById,
  createDonation,
  updateDonation,
  getDonationStats,
};
