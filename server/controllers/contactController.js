const ContactMessage = require("../models/ContactMessage");

// Only the fields the Contact form actually collects - never trust req.body
// wholesale (matches the allowlist approach used for property updates).
const CONTACT_FIELDS = ["name", "email", "phone", "subject", "message"];

exports.submitContactMessage = async (req, res) => {
  try {
    const contactData = {};
    for (const field of CONTACT_FIELDS) {
      if (req.body[field] !== undefined) {
        contactData[field] = req.body[field];
      }
    }

    const saved = await ContactMessage.create(contactData);

    // Log only a non-sensitive identifier - never the message body, and
    // never the submitter's email/phone alongside other personal details.
    console.log("New contact message received:", saved._id.toString());

    res.status(201).json({
      message: "Thank you for contacting us! We will get back to you soon.",
    });
  } catch (error) {
    console.error("Error saving contact message:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: "Please check your submission and try again.",
      });
    }
    res.status(500).json({
      message: "Failed to send message. Please try again later.",
    });
  }
};
