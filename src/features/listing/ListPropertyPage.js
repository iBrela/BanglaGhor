import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Container,
  Typography,
  Box,
  Paper,
  Button,
  Stepper,
  Step,
  StepLabel,
  Snackbar,
  useMediaQuery,
  Alert,
  useTheme,
  CircularProgress,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

import InfoIcon from "@mui/icons-material/Info"; 
import LocationOnIcon from "@mui/icons-material/LocationOn"; 
import ListAltIcon from "@mui/icons-material/ListAlt"; 
import DescriptionIcon from "@mui/icons-material/Description"; 
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";


import useListingForm from "./hooks/useListingForm";
import Step1Details from "./components/Step1_Details";
import Step2Location from "./components/Step2_Location";
import Step3PropertyDetails from "./components/Step3_PropertyDetails";
import Step4Images from "./components/Step4_Images";
import StepDescription from "./components/Step_Description";
import Step5Review from "./components/Step5_Review";
import ConfirmationDialog from "../../components/common/ConfirmationDialog";


const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(4),
  borderRadius: "16px",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08)", 
  marginTop: theme.spacing(4),
  marginBottom: theme.spacing(4),

  
  backgroundColor: "#D9F2F0", 

  border: `1px solid #A0DAD6`, 
  
  background: "none", 
  "&::before": {
    display: "none", 
  },
}));

const StyledButton = styled(Button)(({ theme }) => ({
  borderRadius: "8px",
  padding: theme.spacing(1.2, 3),
  fontWeight: 600,
  textTransform: "none",
}));

const ListPropertyPage = () => {
  const { t } = useTranslation();
  // const { user, isLoggedIn } = useAuth(); // isLoggedIn is no longer needed here
  const navigate = useNavigate(); // Keep navigate if used elsewhere
  const theme = useTheme();
  
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [isCancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const {
    activeStep,
    steps,
    formData,
    features,
    imageUrls,
    imageUploadStates,
    handleImageFileSelected,
    removeImageByUrl,
    errors,
    loadingSubmit,
    snackbar,
    handleChange,
    handleAddressTextChange,
    handleAddressSelect,
    handleFeatureChange,
    handleNext,
    handleBack,
    handleSubmit,
    handleCloseSnackbar,
    enhancingDescription,
    handleEnhanceDescription,
  } = useListingForm();

  const currentStepLabel =
    activeStep >= 0 && activeStep < steps.length ? steps[activeStep] : "";

  const currentStepTitle = t(
    `step_${currentStepLabel.toLowerCase().replace(/ /g, "_")}`,
    currentStepLabel 
  );

  const stepIcons = [
    InfoIcon,
    LocationOnIcon,
    ListAltIcon,
    DescriptionIcon,
    PhotoLibraryIcon,
    CheckCircleOutlineIcon,
  ];
  const CurrentStepIcon = stepIcons[activeStep] || InfoIcon;

  const confirmCancelListing = () => {
    setCancelConfirmOpen(false); 
    navigate("/home"); 
  };

  const closeCancelConfirmDialog = () => {
    setCancelConfirmOpen(false);
  };

  
  const getStepContent = (step) => {
    switch (step) {
      case 0: // Basic Info
        return (
          <Step1Details
            formData={formData}
            errors={errors}
            handleChange={handleChange}
          />
        );
      case 1: // Location
        return (
          <Step2Location
            formData={formData}
            errors={errors}
            handleChange={handleChange}
            onAddressTextChange={handleAddressTextChange}
            onAddressSelect={handleAddressSelect}
          />
        );
      case 2: // Property Details (bedrooms/bathrooms, standard features, and
        // the genuinely-used Bangladesh-specific fields, consolidated)
        return (
          <Step3PropertyDetails
            formData={formData}
            errors={errors}
            features={features}
            handleChange={handleChange}
            handleFeatureChange={handleFeatureChange}
          />
        );
      case 3: // Description & Features
        return (
          <StepDescription
            formData={formData}
            errors={errors}
            handleChange={handleChange}
            onEnhanceDescription={handleEnhanceDescription}
            enhancingDescription={enhancingDescription}
          />
        );
      case 4: // Photos
        return (
          <Step4Images
            imageUrls={imageUrls}
            imageUploadStates={imageUploadStates}
            handleImageFileSelected={handleImageFileSelected}
            removeImageByUrl={removeImageByUrl}
            errors={errors}
          />
        );
      case 5: // Review & Publish
        return (
          <Step5Review
            formData={formData}
            features={features}
            images={imageUrls}
          />
        );
      default:
        console.error("Unknown step index:", step);
        throw new Error("Unknown step");
    }
  };

  
  return (
    <Container maxWidth="md">
      <StyledPaper>
        <Typography
          component="h1"
          variant="h4"
          align="center"
          gutterBottom
          sx={{
            color: "#2C3E50", 
            fontWeight: 700,
          }}
        >
          {t("list_your_property")}
        </Typography>
        {isMobile ? (
         
          <Box
            sx={{
              my: 3, 
              display: "flex",
              flexDirection: "column", 
              alignItems: "center",
              gap: 0.5, 
            }}
          >
            {/* Ensure CurrentStepIcon and currentStepTitle are correctly defined and available in this scope */}
            {CurrentStepIcon && (
              <CurrentStepIcon
                sx={{ fontSize: "2rem", color: "primary.main" }}
              />
            )}
            <Typography
              variant="h6"
              component="div"
              sx={{
                fontWeight: 600,
                color: "#2C3E50",
              }}
            >
              {currentStepTitle}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t("step_progress", "Step {{current}} of {{total}}", {
                current: activeStep + 1,
                total: steps.length,
              })}
            </Typography>
          </Box>
        ) : (
          // --- Desktop View: Standard Horizontal Stepper ---
          <Stepper activeStep={activeStep} sx={{ pt: 3, pb: 5 }}>
            {steps.map((label) => {
              return (
                <Step key={label}>
                  <StepLabel>
                    {t(`step_${label.toLowerCase().replace(/ /g, "_")}`, label)}
                  </StepLabel>
                </Step>
              );
            })}
          </Stepper>
        )}

        <Box sx={{ mb: 4 }}>{getStepContent(activeStep)}</Box>

        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mt: 4,
          }}
        >
          {/* Back Button */}
          <Button
            disabled={activeStep === 0 || loadingSubmit || enhancingDescription}
            onClick={handleBack}
            variant="outlined"
            color="primary"
            sx={{ borderRadius: "8px", textTransform: "none" }}
          >
            {t("back", "Back")}
          </Button>

          {/* Cancel Button */}
          <Button
            variant="outlined"
            color="error"
            onClick={() => setCancelConfirmOpen(true)}
            disabled={loadingSubmit || enhancingDescription}
            sx={{ borderRadius: "8px", textTransform: "none", mx: 2 }}
          >
            {t("cancel_listing", "Cancel Listing")}
          </Button>

          {/* Continue/Submit Button */}
          <StyledButton
            variant="contained"
            color="primary"
            disabled={loadingSubmit || enhancingDescription}
            onClick={
              activeStep === steps.length - 1 ? handleSubmit : handleNext
            }
            sx={{ ml: "auto" }}
          >
            {loadingSubmit || enhancingDescription ? (
              <CircularProgress size={24} color="inherit" />
            ) : activeStep === steps.length - 1 ? (
              t("submit_property")
            ) : (
              t("continue")
            )}
          </StyledButton>
        </Box>
      </StyledPaper>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: "100%", borderRadius: "8px" }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      <ConfirmationDialog
        open={isCancelConfirmOpen}
        onClose={closeCancelConfirmDialog}
        onConfirm={confirmCancelListing}
        title={t(
          "cancel_listing_confirmation_title",
          "Cancel Property Listing"
        )}
        message={t(
          "cancel_listing_confirmation_message",
          "Are you sure you want to cancel listing this property? Any progress will be lost."
        )}
        confirmText={t("yes_cancel_listing", "Yes, Cancel Listing")}
        cancelText={t("no_continue_editing", "No, Continue Editing")}
        confirmButtonProps={{ color: "error" }}
        cancelButtonProps={{ color: "primary" }}
        isConfirming={false} 
      />
    </Container>
  );
};

export default ListPropertyPage;
