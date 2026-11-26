import { User } from "../models/User.js";

export async function listUsers(request, response) {
  try {
    const filter = {};
    if (request.query.role) filter.role = request.query.role;
    if (request.query.stream) filter.stream = request.query.stream;
    if (request.query.status && ["pending", "active", "suspended", "deleted"].includes(request.query.status)) {
      filter.status = request.query.status;
    }
    if (request.query.emailVerified === "true") filter.emailVerified = true;
    if (request.query.emailVerified === "false") filter.emailVerified = false;
    if (request.query.search) {
      const q = String(request.query.search).trim();
      filter.$or = [
        { displayName: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } }
      ];
    }

    const users = await User.find(filter)
      .select("-passwordHash")
      .sort({ createdAt: -1 })
      .limit(200);

    return response.json({ users });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to fetch users." });
  }
}

export async function updateUserRole(request, response) {
  try {
    const { id } = request.params;
    const { role } = request.body;

    if (!["student", "teacher", "content_manager", "cash_manager", "admin"].includes(role)) {
      return response.status(400).json({ error: "Invalid role specified." });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { role } },
      { new: true }
    ).select("-passwordHash");

    if (!user) {
      return response.status(404).json({ error: "User not found." });
    }

    return response.json({ user });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to update user role." });
  }
}

export async function updateUserStatus(request, response) {
  try {
    const { id } = request.params;
    const { status, isPremium, emailVerified } = request.body;

    const updates = {};
    if (status && ["pending", "active", "suspended", "deleted"].includes(status)) {
      updates.status = status;
      // Activating an account marks their email as verified automatically
      if (status === "active" && emailVerified === undefined) {
        updates.emailVerified = true;
      }
    }
    if (typeof emailVerified === "boolean") {
      updates.emailVerified = emailVerified;
      // If marking as email-verified and status was pending, activate the user
      if (emailVerified && !status) {
        updates.status = "active";
      }
    }
    if (typeof isPremium === "boolean") {
      updates.isPremium = isPremium;
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true }
    ).select("-passwordHash");

    if (!user) {
      return response.status(404).json({ error: "User not found." });
    }

    return response.json({ user });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to update user status." });
  }
}

export async function createStaffUser(request, response) {
  try {
    const { email, password, displayName, role = "content_manager", phoneNumber } = request.body;

    if (!email || !password || !displayName) {
      return response.status(400).json({ error: "Email, password, and displayName are required." });
    }

    if (String(password).length < 8) {
      return response.status(400).json({ error: "Password must be at least 8 characters long." });
    }

    if (!["teacher", "content_manager", "cash_manager", "admin"].includes(role)) {
      return response.status(400).json({ error: "Invalid staff role specified." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return response.status(409).json({ error: "A user with this email already exists." });
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({
      email: normalizedEmail,
      displayName: String(displayName).trim(),
      phoneNumber: phoneNumber ? String(phoneNumber).trim() : undefined,
      passwordHash,
      role,
      status: "active",
      emailVerified: true
    });

    return response.status(201).json({
      message: "Staff member created and activated successfully.",
      user: {
        id: user._id,
        _id: user._id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified
      }
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: error.message || "Failed to create staff account." });
  }
}

