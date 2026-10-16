import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, getSafeAuthErrorMessage } from "../../../context/AuthContext";

/**
 * @hook useLogin
 * Handles the state and logic for the user login process.
 * @returns {object} - Login state, handlers, and form data.
 */
const useLogin = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(""); //
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openSnackbar, setOpenSnackbar] = useState(false);

  const handleEmailChange = useCallback(
    (event) => {
      setEmail(event.target.value);
      if (error) setError("");
    },
    [error]
  );

  const handlePasswordChange = useCallback(
    (event) => {
      setPassword(event.target.value);
      if (error) setError("");
    },
    [error]
  );

  const handleLoginSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setError("");

      if (!email || !password) {
        setError("Please enter both email and password.");
        return;
      }

      if (!/\S+@\S+\.\S+/.test(email)) {
        setError("Please enter a valid email address.");
        return;
      }

      setIsSubmitting(true); //
      let navigatedToChangePassword = false; // Flag to track navigation

      try {
        await login(email, password);
        setOpenSnackbar(true);
        setTimeout(() => {
          navigate("/");
        }, 1500);
      } catch (err) {
        // Dev-only diagnostic - err.code/err.name are always the real
        // Cognito exception type, never sensitive (no password/token is
        // ever part of this error object).
        console.error("Login error:", err?.code || err?.name, err);

        if (err.message === "New password required.") {
          // Pass only the (non-sensitive) email through React Router's
          // in-memory navigation state - the temporary password is never
          // persisted client-side; the user re-enters it on the
          // change-password page's existing "Temporary Password" field.
          navigatedToChangePassword = true;
          navigate("/change-password", { state: { email } });
          return;
        }

        // Branch on err.code/err.name (the real Cognito exception type),
        // not err.message - Cognito error messages don't reliably contain
        // the exception name as a substring, and some Cognito errors (e.g.
        // ResourceNotFoundException) have no usable message at all.
        const errorCode = err?.code || err?.name || "";
        const safeMessage = getSafeAuthErrorMessage(
          err,
          "Unable to sign in. Please check your account details and try again."
        );

        if (errorCode === "UserNotFoundException") {
          setError("No account found with this email.");
        } else if (errorCode === "NotAuthorizedException") {
          setError("Incorrect email or password.");
        } else if (errorCode === "UserNotConfirmedException") {
          setError(
            "Account not verified. Please check your email for verification instructions or sign up again."
          );
        } else {
          setError(safeMessage);
        }
      } finally {
        // Only set isSubmitting to false if we haven't navigated to change password
        if (!navigatedToChangePassword) {
          setIsSubmitting(false);
        }
      }
    },
    [email, password, login, navigate]
  );

  const handleCloseSnackbar = useCallback((event, reason) => {
    if (reason === "clickaway") {
      //
      return;
    }
    setOpenSnackbar(false);
  }, []);

  return {
    email,
    password,
    error,
    isSubmitting,
    openSnackbar,
    handleEmailChange,
    handlePasswordChange,
    handleLoginSubmit,
    handleCloseSnackbar,
  };
};

export default useLogin;
