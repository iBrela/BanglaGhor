import { useState, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import { CognitoUser, AuthenticationDetails } from "amazon-cognito-identity-js";
import { userPool } from "../../../aws/CognitoConfig";

/**
 * @hook useChangePassword
 * Handles the state and logic for changing a user's password when required by Cognito.
 * @returns {object} - Form state, handlers, and feedback.
 */
const useChangePassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  // State for form fields
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // State for feedback and loading
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openSnackbar, setOpenSnackbar] = useState(false);

  // Retrieve the (non-sensitive) email from React Router's in-memory
  // navigation state - see useLogin.js's navigate("/change-password",
  // { state: { email } }). The temporary password is never persisted
  // anywhere client-side; the user re-enters it on this page's existing
  // "Temporary Password" field (see ChangePasswordForm.js). Note:
  // history.state (and so location.state) is preserved by the browser
  // across a same-entry reload - only the email survives a refresh this
  // way, never the password, since temporaryPassword is plain component
  // state that's reset whenever the app reinitializes. If email is
  // missing entirely (direct visit with no history, or a cleared/expired
  // entry), safely restart at /login rather than trying to recover it.
  useEffect(() => {
    // One-time defensive cleanup: purge any stale values a browser might
    // still be holding from the previous (pre-Fix #10) implementation,
    // which stored the temporary password in localStorage.
    localStorage.removeItem("pendingChangePasswordEmail");
    localStorage.removeItem("pendingChangePasswordTempPassword");

    const stateEmail = location.state?.email;
    if (stateEmail) {
      setEmail(stateEmail);
    } else {
      setError("Missing email. Please try logging in again.");
      navigate("/login");
    }
  }, [location.state, navigate]);

  /**
   * Handles changes in the name input field.
   */
  const handleNameChange = useCallback((event) => {
    const value = event.target.value;
    setName(value);
    console.log("Name input changed to:", value);
    if (error) setError("");
  }, [error]);

  /**
   * Handles changes in the temporary password input field.
   */
  const handleTemporaryPasswordChange = useCallback((event) => {
    const value = event.target.value;
    setTemporaryPassword(value);
    if (error) setError("");
  }, [error]);

  /**
   * Handles changes in the new password input field.
   */
  const handleNewPasswordChange = useCallback((event) => {
    const value = event.target.value;
    setNewPassword(value);
    if (error) setError("");
  }, [error]);

  /**
   * Handles changes in the confirm password input field.
   */
  const handleConfirmPasswordChange = useCallback((event) => {
    const value = event.target.value;
    setConfirmPassword(value);
    if (error) setError("");
  }, [error]);

  /**
   * Handles the change password form submission.
   * Validates inputs, re-authenticates to get a session, and completes the new password challenge.
   * @param {React.FormEvent} e - The form submission event.
   */
  const handleChangePasswordSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");

      if (!name) {
        setError("Please enter your name.");
        return;
      }
      if (!temporaryPassword) {
        setError("Please enter your temporary password.");
        return;
      }
      if (!newPassword) {
        setError("Please enter a new password.");
        return;
      }
      if (!confirmPassword) {
        setError("Please confirm your new password.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
      if (newPassword.length < 8) {
        setError("Password must be at least 8 characters long.");
        return;
      }
      if (name.trim().length === 0) {
        setError("Name cannot be empty.");
        return;
      }

      setIsSubmitting(true);

      try {
        console.log("Creating CognitoUser for:", email);
        const cognitoUser = new CognitoUser({
          Username: email,
          Pool: userPool,
        });

        console.log("Authenticating user with temporary password...");
        const authenticationDetails = new AuthenticationDetails({
          Username: email,
          Password: temporaryPassword,
        });

        await new Promise((resolve, reject) => {
          cognitoUser.authenticateUser(authenticationDetails, {
            onSuccess: () => {
              reject(new Error("Unexpected success during temporary password authentication."));
            },
            onFailure: (err) => {
              console.error("Authentication failure:", err.code || err.message);
              if (err.code === "NotAuthorizedException") {
                reject(new Error("Incorrect temporary password."));
              } else {
                reject(err);
              }
            },
            newPasswordRequired: (userAttributes, requiredAttributes) => {
              console.log("newPasswordRequired triggered, proceeding with new password...");
              resolve();
            },
          });
        });

        console.log("Attempting to complete new password challenge...");
        const userAttributes = {
          name: name.trim(),
        };

        await new Promise((resolve, reject) => {
          cognitoUser.completeNewPasswordChallenge(
            newPassword,
            userAttributes,
            {
              onSuccess: async () => {
                console.log("Password changed successfully");
                await login(email, newPassword);
                setOpenSnackbar(true);
                setTimeout(() => {
                  navigate("/");
                }, 1500);
                resolve();
              },
              onFailure: (err) => {
                console.error("Password change failed:", err.code || err.message);
                if (err.code === "InvalidPasswordException") {
                  reject(
                    new Error(
                      "Password does not meet requirements. Must include uppercase, lowercase, numbers, and special characters."
                    )
                  );
                } else if (err.code === "NotAuthorizedException") {
                  reject(
                    new Error(
                      "Session expired or invalid. Please try logging in again."
                    )
                  );
                } else {
                  reject(err);
                }
              },
            }
          );
        });
      } catch (err) {
        console.error("Change password error:", err.code || err.message);
        const message =
          err.message || "Failed to change password. Please try again.";
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, name, temporaryPassword, newPassword, confirmPassword, login, navigate]
  );


  const handleCloseSnackbar = useCallback((event, reason) => {
    if (reason === "clickaway") {
      return;
    }
    setOpenSnackbar(false);
  }, []);

  const hookReturn = {
    email,
    name,
    temporaryPassword,
    newPassword,
    confirmPassword,
    error,
    isSubmitting,
    openSnackbar,
    handleNameChange,
    handleTemporaryPasswordChange,
    handleNewPasswordChange,
    handleConfirmPasswordChange,
    handleChangePasswordSubmit,
    handleCloseSnackbar,
  };

  return hookReturn;
};

export default useChangePassword;