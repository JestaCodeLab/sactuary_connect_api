import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import Member from '../models/Member.js';
import Department from '../models/Department.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';
import { normalizePhone } from '../utils/phoneUtils.js';
import { checkMemberLimit } from '../utils/usageLimits.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORTS_DIR = path.join(__dirname, '../../exports');

// Validate family members exist and belong to the same organization
const validateFamilyMembers = async (familyMembers, organizationId, currentMemberId) => {
  if (!familyMembers || familyMembers.length === 0) {
    return true;
  }

  if (!Array.isArray(familyMembers)) {
    throw new Error('familyMembers must be an array');
  }

  // Validate structure and relationships
  const memberIds = new Set();
  for (const familyMember of familyMembers) {
    if (!familyMember.memberId || !familyMember.relationship) {
      throw new Error('Each family member must have memberId and relationship');
    }

    if (memberIds.has(familyMember.memberId)) {
      throw new Error('Duplicate family member IDs');
    }
    memberIds.add(familyMember.memberId);

    if (familyMember.memberId === currentMemberId) {
      throw new Error('Cannot add member as their own family member');
    }
  }

  // Validate all members exist and belong to same organization
  const members = await Member.find({
    _id: { $in: Array.from(memberIds) },
    organizationId,
  });

  if (members.length !== memberIds.size) {
    throw new Error('One or more family members not found or belong to a different organization');
  }

  return true;
};

export const getAllMembers = async (req, res) => {
  try {
    const { search, startDate, endDate } = req.query;
    const filter = branchFilter(req);

    // Add search filter if provided
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
      ];
    }

    // Add date range filter for createdAt
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const members = await Member.find(filter)
      .populate('branchId', 'name')
      .populate('departments', 'name');
    res.json(members);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
};

export const getMemberById = async (req, res) => {
  try {
    const { id } = req.params;
    const member = await Member.findById(id)
      .populate('branchId', 'name')
      .populate('departments', 'name');

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json(member);
  } catch (error) {
    console.error('Error fetching member:', error);
    res.status(500).json({ error: 'Failed to fetch member' });
  }
};

export const createMember = async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone,
      dateOfBirth, gender, maritalStatus,
      address, city, suburb, region, zipCode, country,
      baptismDate, membershipDate, memberStatus,
      familyMembers, departments, notes,
    } = req.body;

    if (!firstName || !lastName || !phone) {
      return res.status(400).json({ error: 'First name, last name, and phone are required' });
    }

    // Check member limit
    const limitCheck = await checkMemberLimit(req.organizationId);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Member limit reached. Current: ${limitCheck.current}/${limitCheck.limit}`,
        code: 'MEMBER_LIMIT_EXCEEDED',
        current: limitCheck.current,
        limit: limitCheck.limit,
      });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    // Validate family members before creating
    if (familyMembers && familyMembers.length > 0) {
      try {
        await validateFamilyMembers(familyMembers, req.organizationId, null);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }
    }

    const uniqueDepartments = departments && Array.isArray(departments) ? [...new Set(departments)] : [];

    const member = await Member.create({
      organizationId: req.organizationId,
      branchId,
      firstName,
      lastName,
      email,
      phone: normalizePhone(phone),
      dateOfBirth,
      gender,
      maritalStatus,
      address,
      city,
      suburb,
      region,
      zipCode,
      country,
      baptismDate,
      membershipDate,
      memberStatus: memberStatus || 'active',
      familyMembers,
      departments: uniqueDepartments,
      notes,
    });

    // Add member to selected departments
    if (uniqueDepartments.length > 0) {
      await Department.updateMany(
        { _id: { $in: uniqueDepartments } },
        { $addToSet: { members: member._id } }
      );
    }

    const populated = await Member.findById(member._id)
      .populate('branchId', 'name')
      .populate('departments', 'name');

    res.status(201).json(populated);
  } catch (error) {
    console.error('Error creating member:', error);
    res.status(500).json({ error: 'Failed to create member' });
  }
};

export const updateMember = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Get the current member to check department changes
    const currentMember = await Member.findById(id);
    if (!currentMember) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates._id;
    delete updates.userId;
    delete updates.organizationId;
    delete updates.branchId;

    // Validate family members if being updated
    if (updates.familyMembers) {
      try {
        await validateFamilyMembers(updates.familyMembers, req.organizationId, id);
      } catch (validationError) {
        return res.status(400).json({ error: validationError.message });
      }
    }

    // Handle department changes
    if (updates.departments !== undefined) {
      const newDepartments = Array.isArray(updates.departments) ? [...new Set(updates.departments)] : [];
      const oldDepartments = currentMember.departments || [];

      // Find departments to remove from and add to
      const depsToRemove = oldDepartments.filter(d => !newDepartments.includes(d.toString()));
      const depsToAdd = newDepartments.filter(d => !oldDepartments.map(d => d.toString()).includes(d));

      // Remove member from old departments
      if (depsToRemove.length > 0) {
        await Department.updateMany(
          { _id: { $in: depsToRemove } },
          { $pull: { members: id } }
        );
      }

      // Add member to new departments
      if (depsToAdd.length > 0) {
        await Department.updateMany(
          { _id: { $in: depsToAdd } },
          { $addToSet: { members: id } }
        );
      }

      updates.departments = newDepartments;
    }

    updates.updatedAt = Date.now();

    const member = await Member.findByIdAndUpdate(id, updates, { new: true })
      .populate('branchId', 'name')
      .populate('departments', 'name');

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json(member);
  } catch (error) {
    console.error('Error updating member:', error);
    res.status(500).json({ error: 'Failed to update member' });
  }
};

export const deleteMember = async (req, res) => {
  try {
    const { id } = req.params;
    const member = await Member.findByIdAndDelete(id);

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    // Remove this member from all other members' familyMembers arrays
    await Member.updateMany(
      { familyMembers: id },
      { $pull: { familyMembers: id } }
    );

    // Remove member from all departments
    if (member.departments && member.departments.length > 0) {
      await Department.updateMany(
        { _id: { $in: member.departments } },
        { $pull: { members: id } }
      );
    }

    res.json({ message: 'Member deleted successfully' });
  } catch (error) {
    console.error('Error deleting member:', error);
    res.status(500).json({ error: 'Failed to delete member' });
  }
};

export const getUpcomingBirthdays = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const now = new Date();
    const currentDayOfYear = Math.floor(
      (now - new Date(now.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24)
    );

    // Find members with dateOfBirth set, then filter by upcoming birthdays
    const members = await Member.find({
      ...branchFilter(req),
      dateOfBirth: { $ne: null },
    });

    const today = [];
    const upcoming = [];

    members.forEach((member) => {
      const dob = new Date(member.dateOfBirth);
      // Create a birthday date in the current year
      const birthdayThisYear = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());

      // If birthday already passed this year, check next year
      let nextBirthday = birthdayThisYear;
      if (birthdayThisYear < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
        nextBirthday = new Date(now.getFullYear() + 1, dob.getMonth(), dob.getDate());
      }

      const diffTime = nextBirthday.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        const age = now.getFullYear() - dob.getFullYear();
        today.push({ ...member.toObject(), age, daysUntilBirthday: 0 });
      } else if (diffDays > 0 && diffDays <= days) {
        const age = nextBirthday.getFullYear() - dob.getFullYear();
        upcoming.push({ ...member.toObject(), age, daysUntilBirthday: diffDays });
      }
    });

    // Sort upcoming by nearest birthday
    upcoming.sort((a, b) => a.daysUntilBirthday - b.daysUntilBirthday);

    res.json({ today, upcoming });
  } catch (error) {
    console.error('Error fetching upcoming birthdays:', error);
    res.status(500).json({ error: 'Failed to fetch upcoming birthdays' });
  }
};

// Export members as CSV or PDF — generates file on server and returns download URL
export const exportMembers = async (req, res) => {
  try {
    const { format = 'csv', startDate, endDate, period } = req.query;
    const filter = branchFilter(req);

    // Calculate date range based on period
    if (period === 'monthly') {
      const now = new Date();
      filter.createdAt = {
        $gte: new Date(now.getFullYear(), now.getMonth(), 1),
        $lte: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      };
    } else if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const members = await Member.find(filter)
      .populate('branchId', 'name')
      .populate('departments', 'name')
      .sort({ firstName: 1, lastName: 1 });

    // Ensure exports directory exists
    if (!fs.existsSync(EXPORTS_DIR)) {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }

    const fileId = uuidv4();
    const baseUrl = process.env.API_URL || `${req.protocol}://${req.get('host')}`;

    if (format === 'csv') {
      const csvHeaders = [
        'First Name', 'Last Name', 'Email', 'Phone', 'Gender',
        'Date of Birth', 'Marital Status', 'Address', 'City',
        'Suburb', 'Region', 'Zip Code', 'Country', 'Baptism Date',
        'Membership Date', 'Status', 'Branch', 'Departments', 'Created At'
      ].join(',');

      const csvRows = members.map(m => {
        const branchName = m.branchId && typeof m.branchId === 'object' ? m.branchId.name : '';
        const deptNames = m.departments?.map(d => typeof d === 'object' ? d.name : d).join('; ') || '';
        return [
          m.firstName,
          m.lastName,
          m.email,
          m.phone || '',
          m.gender || '',
          m.dateOfBirth ? new Date(m.dateOfBirth).toISOString().split('T')[0] : '',
          m.maritalStatus || '',
          m.address || '',
          m.city || '',
          m.suburb || '',
          m.region || '',
          m.zipCode || '',
          m.country || '',
          m.baptismDate ? new Date(m.baptismDate).toISOString().split('T')[0] : '',
          m.membershipDate ? new Date(m.membershipDate).toISOString().split('T')[0] : '',
          m.memberStatus,
          branchName,
          deptNames,
          new Date(m.createdAt).toISOString().split('T')[0],
        ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
      });

      const csv = [csvHeaders, ...csvRows].join('\n');
      const fileName = `members-export-${fileId}.csv`;
      const filePath = path.join(EXPORTS_DIR, fileName);
      fs.writeFileSync(filePath, csv);

      return res.json({ downloadUrl: `${baseUrl}/exports/${fileName}` });
    }

    // PDF generation
    const fileName = `members-export-${fileId}.pdf`;
    const filePath = path.join(EXPORTS_DIR, fileName);

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // Title
      doc.fontSize(18).font('Helvetica-Bold').text('Members Directory', { align: 'center' });
      doc.fontSize(10).font('Helvetica').text(`Exported on: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown(1);

      // Table setup
      const headers = ['Name', 'Email', 'Phone', 'Status', 'Gender', 'Joined Date'];
      const colWidths = [140, 180, 110, 70, 60, 90];
      const tableLeft = 30;
      const rowHeight = 20;

      // Draw header row
      let y = doc.y;
      doc.fontSize(9).font('Helvetica-Bold');
      doc.rect(tableLeft, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#f4f4f4').stroke('#dddddd');
      doc.fillColor('#000000');
      let x = tableLeft + 5;
      headers.forEach((header, i) => {
        doc.text(header, x, y + 5, { width: colWidths[i] - 10, lineBreak: false });
        x += colWidths[i];
      });
      y += rowHeight;

      // Draw data rows
      doc.font('Helvetica').fontSize(8);
      members.forEach((m, rowIndex) => {
        // Check if we need a new page
        if (y + rowHeight > doc.page.height - 30) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 30 });
          y = 30;
          // Redraw headers on new page
          doc.fontSize(9).font('Helvetica-Bold');
          doc.rect(tableLeft, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#f4f4f4').stroke('#dddddd');
          doc.fillColor('#000000');
          let hx = tableLeft + 5;
          headers.forEach((header, i) => {
            doc.text(header, hx, y + 5, { width: colWidths[i] - 10, lineBreak: false });
            hx += colWidths[i];
          });
          y += rowHeight;
          doc.font('Helvetica').fontSize(8);
        }

        const rowData = [
          `${m.firstName} ${m.lastName}`,
          m.email,
          m.phone || '-',
          m.memberStatus,
          m.gender || '-',
          m.membershipDate ? new Date(m.membershipDate).toLocaleDateString() : '-',
        ];

        // Alternating row background
        if (rowIndex % 2 === 0) {
          doc.rect(tableLeft, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#f9f9f9').stroke('#dddddd');
        } else {
          doc.rect(tableLeft, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#ffffff').stroke('#dddddd');
        }

        doc.fillColor('#000000');
        x = tableLeft + 5;
        rowData.forEach((cell, i) => {
          doc.text(cell, x, y + 5, { width: colWidths[i] - 10, lineBreak: false });
          x += colWidths[i];
        });
        y += rowHeight;
      });

      doc.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    res.json({ downloadUrl: `${baseUrl}/exports/${fileName}` });
  } catch (error) {
    console.error('Error exporting members:', error);
    res.status(500).json({ error: 'Failed to export members' });
  }
};

// Import members from CSV
export const importMembers = async (req, res) => {
  try {
    const { members: membersData, branchId } = req.body;

    if (!Array.isArray(membersData) || membersData.length === 0) {
      return res.status(400).json({ error: 'No members data provided' });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [],
    };

    for (const memberData of membersData) {
      try {
        // Validate required fields
        if (!memberData.firstName || !memberData.lastName || !memberData.phone) {
          results.failed++;
          results.errors.push(`Missing required fields for: ${memberData.phone || memberData.firstName || 'unknown'}`);
          continue;
        }

        // Check if member with phone already exists
        const existingMember = await Member.findOne({
          phone: normalizePhone(memberData.phone),
          organizationId: req.organizationId,
        });

        if (existingMember) {
          results.failed++;
          results.errors.push(`Member with phone ${memberData.phone} already exists`);
          continue;
        }

        const newMember = new Member({
          firstName: memberData.firstName,
          lastName: memberData.lastName,
          email: memberData.email ? memberData.email.toLowerCase() : null,
          phone: normalizePhone(memberData.phone),
          gender: memberData.gender || null,
          dateOfBirth: memberData.dateOfBirth ? new Date(memberData.dateOfBirth) : null,
          maritalStatus: memberData.maritalStatus || null,
          address: memberData.address || null,
          city: memberData.city || null,
          suburb: memberData.suburb || null,
          region: memberData.region || null,
          zipCode: memberData.zipCode || null,
          country: memberData.country || null,
          baptismDate: memberData.baptismDate ? new Date(memberData.baptismDate) : null,
          membershipDate: memberData.membershipDate ? new Date(memberData.membershipDate) : null,
          memberStatus: memberData.memberStatus || 'active',
          organizationId: req.organizationId,
          branchId: branchId || req.branchId,
        });

        await newMember.save();
        results.success++;
      } catch (memberError) {
        results.failed++;
        results.errors.push(`Error importing ${memberData.email}: ${memberError.message}`);
      }
    }

    res.json({
      message: `Imported ${results.success} members, ${results.failed} failed`,
      ...results,
    });
  } catch (error) {
    console.error('Error importing members:', error);
    res.status(500).json({ error: 'Failed to import members' });
  }
};

// Get import template (CSV headers)
export const getImportTemplate = async (req, res) => {
  const headers = [
    'firstName', 'lastName', 'email', 'phone', 'gender',
    'dateOfBirth', 'maritalStatus', 'address', 'city',
    'suburb', 'region', 'zipCode', 'country', 'baptismDate',
    'membershipDate', 'memberStatus'
  ];
  
  const sampleRow = [
    'John', 'Doe', 'john.doe@example.com', '+1234567890', 'male',
    '1990-01-15', 'married', '123 Main St', 'New York',
    'Manhattan', 'NY', '10001', 'USA', '2020-06-15',
    '2019-01-01', 'active'
  ];

  const csv = [headers.join(','), sampleRow.join(',')].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=member-import-template.csv');
  res.send(csv);
};

export default {
  getAllMembers,
  getMemberById,
  createMember,
  updateMember,
  deleteMember,
  getUpcomingBirthdays,
  exportMembers,
  importMembers,
  getImportTemplate,
};
