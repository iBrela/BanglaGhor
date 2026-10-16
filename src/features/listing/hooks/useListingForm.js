import { useState, useCallback, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../context/AuthContext";

const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5001/api";

// 6 meaningful steps (Phase 2 restructure - was 7: Basic Info / Location /
// Features / Specific Details / Upload Photos / Description / Review).
// Bedrooms/bathrooms moved out of Basic Info into Property Details; the old
// standalone Features step and the genuinely-used subset of the old
// Bangladesh-specific step are consolidated into one Property Details step
// (see Step3_PropertyDetails.js); Photos now comes after Description to
// match the approved order.
const steps = [
  "Basic Info",
  "Location",
  "Property Details",
  "Description",
  "Photos",
  "Review",
];

const initialFormData = {
  title: "",
  propertyType: "apartment",
  listingType: "rent",
  price: "",
  area: "",
  bedrooms: "",
  bathrooms: "",
  addressLine1: "",
  addressLine2: "",
  cityTown: "",
  upazila: "",
  district: "",
  postalCode: "",
  // Set only when the seller picks a real address-autocomplete suggestion
  // (see handleAddressSelect below) - null otherwise, meaning "let the
  // backend geocode the typed address text exactly as it always has".
  // Reuses the Property schema's own latitude/longitude/geocodedAddress
  // fields, no new ones.
  latitude: null,
  longitude: null,
  geocodedAddress: "",
  description: "",
  // Phase 2 audit: these 16 sub-fields are the only ones with a real
  // downstream consumer - 8 shown on Property Detail / matched by chatbot
  // recommendation logic (propertyCondition, waterSource, gasSource,
  // backupPower, ownershipPapers, balcony, rooftopAccess, securityFeatures -
  // collected in Step3_PropertyDetails.js), and 8 that only ever feed the
  // AI-generated/enhanced description (proximityToMainRoad, roadWidth,
  // naturalLight, nearbySchools, nearbyHospitals, nearbyMarkets,
  // nearbyReligiousPlaces, nearbyOthers - collected in Step_Description.js's
  // optional "help us create a better description" section). The other 12
  // fields the old 7-step form collected (publicTransport, floodProne,
  // gasLineInstalled, sewerSystem, earthquakeResistance, parkingType,
  // floorNumber, totalFloors, propertyTenure, recentRenovations,
  // nearbyDevelopments, reasonForSelling) had no consumer anywhere in
  // Property Detail/Search/Chatbot/Map, so new listings stop collecting
  // them - this is a frontend-only simplification; the Property schema and
  // existing documents are untouched, see server/models/property.js.
  bangladeshDetails: {
    propertyCondition: "",
    proximityToMainRoad: "",
    waterSource: "",
    gasSource: "",
    backupPower: "none",
    nearbySchools: "",
    nearbyHospitals: "",
    nearbyMarkets: "",
    nearbyReligiousPlaces: "",
    nearbyOthers: "",
    securityFeatures: [],
    roadWidth: "",
    balcony: "no",
    rooftopAccess: "no",
    naturalLight: "",
    ownershipPapers: "unknown",
  },
  createdBy: "",
};

const initialFeatures = {
  parking: false,
  garden: false,
  airConditioning: false,
  furnished: "no",
  pool: false,
};

const useListingForm = () => {
  const { user, idToken } = useAuth();
  const { i18n } = useTranslation();
  const navigate = useNavigate();

  const [activeStep, setActiveStep] = useState(0);
  const [formData, setFormData] = useState(initialFormData);
  const [features, setFeatures] = useState(initialFeatures);

  const [imageUrls, setImageUrls] = useState([]);
  const [imageUploadStates, setImageUploadStates] = useState({});

  const [errors, setErrors] = useState({});
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "info",
  });

  useEffect(() => {
    if (user?.email && !formData.createdBy) {
      setFormData((prev) => ({ ...prev, createdBy: user.email }));
    }
  }, [user, formData.createdBy]);

  const handleChange = useCallback(
    (event) => {
      const { name, value, type, checked } = event.target;
      if (name.startsWith("bangladeshDetails.")) {
        const key = name.split(".")[1];
        if (key === "securityFeatures") {
          const list = formData.bangladeshDetails.securityFeatures || [];
          const updated = checked
            ? [...list, value]
            : list.filter((i) => i !== value);
          setFormData((prev) => ({
            ...prev,
            bangladeshDetails: { ...prev.bangladeshDetails, [key]: updated },
          }));
        } else {
          setFormData((prev) => ({
            ...prev,
            bangladeshDetails: {
              ...prev.bangladeshDetails,
              [key]: type === "checkbox" ? checked : value,
            },
          }));
        }
        if (errors.bangladeshDetails?.[key]) {
          setErrors((prev) => ({
            ...prev,
            bangladeshDetails: { ...prev.bangladeshDetails, [key]: null },
          }));
        }
      } else {
        setFormData((prev) => ({
          ...prev,
          [name]: type === "checkbox" ? checked : value,
        }));
        if (errors[name]) setErrors((prev) => ({ ...prev, [name]: null }));
      }
    },
    [errors, formData.bangladeshDetails]
  );

  // Snapshot of exactly which structured fields (cityTown/district/
  // postalCode) the MOST RECENT autocomplete selection populated, and the
  // exact value it set each one to - e.g. { cityTown: "Dhaka", district:
  // "Dhaka Metropolitan" }. A field is only ever included here when the
  // suggestion actually provided a value for it (see handleAddressSelect),
  // so this also IS the project's tracking of "which fields came from the
  // selection" referenced below. null once nothing from a selection is
  // still live (never selected, or already rolled back).
  const [autoFilledBySuggestion, setAutoFilledBySuggestion] = useState(null);

  // Rolls back whichever of `snapshot`'s fields the seller has NOT since
  // edited independently - i.e. the field's current value still exactly
  // equals what the selection set. That equality check is the "has this
  // been manually edited since" signal: if it still matches, it's an
  // untouched leftover from a now-stale/replaced selection and should be
  // cleared; if it no longer matches, the seller already typed something
  // different into that field directly, and that edit is left alone.
  // Shared by both "address text edited manually" and "a NEW suggestion was
  // picked" so a stale value from an OLDER selection never lingers either
  // way.
  const rollBackUneditedAutoFill = useCallback((current, snapshot) => {
    if (!snapshot) return {};
    const rollback = {};
    for (const field of Object.keys(snapshot)) {
      if (current[field] === snapshot[field]) rollback[field] = "";
    }
    return rollback;
  }, []);

  // Manual typing in the address field (including editing text right after
  // a suggestion was selected). Any manual edit invalidates the PRIOR
  // selection entirely: the autocomplete-derived coordinates (the edited
  // text no longer necessarily represents that exact point), AND whichever
  // of cityTown/district/postalCode that same selection auto-filled and the
  // seller hasn't since typed over themselves - silently keeping either
  // would risk saving structured location data that describes a different
  // address than what's now in the field. Backend falls back to its own
  // geocoding of the (now plain-text) address automatically once
  // latitude/longitude are cleared - see getValidSubmittedCoordinates in
  // propertyController.js.
  const handleAddressTextChange = useCallback((text) => {
    setFormData((prev) => ({
      ...prev,
      ...rollBackUneditedAutoFill(prev, autoFilledBySuggestion),
      addressLine1: text,
      latitude: null,
      longitude: null,
      geocodedAddress: "",
    }));
    setAutoFilledBySuggestion(null);
    setErrors((prev) => (prev.addressLine1 ? { ...prev, addressLine1: null } : prev));
  }, [autoFilledBySuggestion, rollBackUneditedAutoFill]);

  // A real address-autocomplete suggestion was picked (see
  // AddressAutocomplete.js). First rolls back any still-untouched fields
  // from a PREVIOUS selection (same rule as above) so picking a new
  // suggestion fully replaces the old structured data instead of merging
  // stale leftovers into it, then applies the new one. Only ever sets a
  // field the suggestion actually provided a value for - never blanks out
  // something the seller already typed with an absence, never invents a
  // value the provider didn't return. `upazila` is populated only when
  // locationService.js's normalizePhotonFeature found a trustworthy,
  // distinct signal for it (see its own comment) - otherwise left for the
  // seller to fill in manually, same as always.
  const handleAddressSelect = useCallback((suggestion) => {
    if (!suggestion) return;
    const newAutoFilled = {};
    if (suggestion.city) newAutoFilled.cityTown = suggestion.city;
    if (suggestion.context?.district) newAutoFilled.district = suggestion.context.district;
    if (suggestion.postcode) newAutoFilled.postalCode = suggestion.postcode;
    if (suggestion.upazila) newAutoFilled.upazila = suggestion.upazila;

    setFormData((prev) => ({
      ...prev,
      ...rollBackUneditedAutoFill(prev, autoFilledBySuggestion),
      ...newAutoFilled,
      addressLine1: suggestion.displayName || prev.addressLine1,
      latitude: suggestion.lat,
      longitude: suggestion.lng,
      geocodedAddress: suggestion.displayName || "",
    }));
    setAutoFilledBySuggestion(newAutoFilled);
    setErrors((prev) => ({
      ...prev,
      addressLine1: null,
      cityTown: null,
      district: null,
      postalCode: null,
      ...(suggestion.upazila ? { upazila: null } : null),
    }));
  }, [autoFilledBySuggestion, rollBackUneditedAutoFill]);

  const handleFeatureChange = useCallback((e) => {
    const { name, checked, value } = e.target;
    setFeatures((prev) => ({
      ...prev,
      [name]: name === "furnished" ? value : checked,
    }));
  }, []);

  const [enhancingDescription, setEnhancingDescription] = useState(false);

  // Shared by both the "Enhance with AI" button and the auto-generate-
  // before-Continue fallback below. sellerText may be blank - the backend
  // branches accordingly (merge vs. generate-from-scratch, see
  // propertyDescriptionService.enhanceOrGenerateDescription). Never throws;
  // returns { description } on success or { errorMessage } on failure so
  // callers can decide how loudly to report it (the button always tells the
  // seller; the silent auto-generate-on-Continue path does not).
  const requestDescriptionFromBackend = useCallback(
    async (sellerText) => {
      if (!idToken) {
        return { errorMessage: "Authentication session error. Please log in again." };
      }
      const isLandOrCommercial =
        formData.propertyType === "land" || formData.propertyType === "commercial";
      const payload = {
        description: sellerText || "",
        title: formData.title,
        propertyType: formData.propertyType,
        listingType: formData.listingType,
        price: formData.price,
        area: formData.area,
        bedrooms: formData.bedrooms,
        bathrooms: formData.bathrooms,
        addressLine1: formData.addressLine1,
        upazila: formData.upazila,
        cityTown: formData.cityTown,
        district: formData.district,
        latitude: formData.latitude,
        longitude: formData.longitude,
        features: isLandOrCommercial ? {} : features,
        bangladeshDetails: formData.bangladeshDetails,
        lang: i18n.language?.toLowerCase().startsWith("bn") ? "bn" : "en",
      };
      try {
        const response = await axios.post(
          `${API_BASE_URL}/properties/enhance-description`,
          payload,
          { headers: { Authorization: `Bearer ${idToken}` } }
        );
        if (response.data?.description) {
          return { description: response.data.description };
        }
        return { errorMessage: "AI enhancement is temporarily unavailable." };
      } catch (err) {
        console.error(
          "Enhance/generate description error:",
          err.response?.data || err.message
        );
        return {
          errorMessage:
            err.response?.data?.message ||
            "AI enhancement is temporarily unavailable. Your description was not changed.",
        };
      }
    },
    [formData, features, idToken, i18n.language]
  );

  // "Enhance with AI" button (Step_Description.js) - seller-triggered only,
  // never auto-called while typing. Always sends the CURRENT textarea
  // content, blank or not: non-blank text is merged with confirmed listing
  // data (seller's facts are the source of truth, preserved on retry too -
  // a second click after editing the first result enhances THAT edited
  // text, never an older generated version); blank text generates a fresh,
  // grounded description straight from confirmed listing data. On failure,
  // the seller's existing description (if any) is left completely
  // untouched - only a snackbar error is shown.
  const handleEnhanceDescription = useCallback(async () => {
    if (enhancingDescription) return; // guard against double-click/double-submit
    setEnhancingDescription(true);
    const result = await requestDescriptionFromBackend(formData.description);
    if (result.description) {
      setFormData((prev) => ({ ...prev, description: result.description }));
      setSnackbar({
        open: true,
        message: "Description updated - review and edit before publishing.",
        severity: "success",
      });
    } else {
      setSnackbar({ open: true, message: result.errorMessage, severity: "error" });
    }
    setEnhancingDescription(false);
  }, [enhancingDescription, formData.description, requestDescriptionFromBackend]);

  const validateStep = useCallback(
    (stepIndex) => {
      const newErrors = {};
      const currentFormData = formData;
      const bdDetails = currentFormData.bangladeshDetails || {};
      const isNumericRequired = (val) =>
        val == null || val === "" || Number(val) <= 0;
      const isPositiveNumericRequired = (val) =>
        val == null || val === "" || Number(val) < 0;
      const needsBuildingSpecifics =
        currentFormData.propertyType !== "land" &&
        currentFormData.propertyType !== "commercial";

      switch (stepIndex) {
        case 0: // Basic Info
          if (!currentFormData.title.trim())
            newErrors.title = "Title is required.";
          if (!currentFormData.propertyType)
            newErrors.propertyType = "Property type is required.";
          if (!currentFormData.listingType)
            newErrors.listingType = "Listing type is required.";
          if (isNumericRequired(currentFormData.price))
            newErrors.price = "Price must be a positive number.";
          break;
        case 1: // Location
          if (!currentFormData.addressLine1.trim())
            newErrors.addressLine1 = "Address Line 1 is required.";
          if (!currentFormData.cityTown.trim())
            newErrors.cityTown = "City/Town is required.";
          if (!currentFormData.upazila.trim())
            newErrors.upazila = "Upazila is required.";
          if (!currentFormData.district.trim())
            newErrors.district = "District is required.";
          if (!currentFormData.postalCode.trim())
            newErrors.postalCode = "Postal Code is required.";
          break;
        case 2: // Property Details - only genuinely required for types that
          // actually have bedrooms/bathrooms/building utilities (not land or
          // commercial). This step is always shown (never skipped) - for
          // land/commercial it just shows fewer required fields, same rule
          // Step3_PropertyDetails.js uses to decide what to render.
          newErrors.bangladeshDetails = {};

          if (needsBuildingSpecifics) {
            if (isPositiveNumericRequired(currentFormData.bedrooms))
              newErrors.bedrooms = "Bedrooms must be zero or more.";
            if (isPositiveNumericRequired(currentFormData.bathrooms))
              newErrors.bathrooms = "Bathrooms must be zero or more.";
            if (!bdDetails.propertyCondition)
              newErrors.bangladeshDetails.propertyCondition =
                "Property condition is required for this property type.";
            if (!bdDetails.waterSource)
              newErrors.bangladeshDetails.waterSource =
                "Water source is required for this property type.";
            if (!bdDetails.gasSource)
              newErrors.bangladeshDetails.gasSource =
                "Gas source is required for this property type.";
          }

          if (Object.keys(newErrors.bangladeshDetails).length === 0) {
            delete newErrors.bangladeshDetails;
          }
          break;

        case 4: // Photos
          if (imageUrls.length === 0) {
            newErrors.images = "At least one photo is required.";
          }
          break;
        default:
          break;
      }
      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [formData, imageUrls]
  );

  // Bilingual description generation now happens automatically server-side
  // on submit (see server/controllers/propertyController.js +
  // server/services/propertyDescriptionService.js) when the seller leaves
  // this field blank - no frontend-triggered AI call needed here anymore.

  // Step index 3 = Description & Features (see `steps` above).
  const DESCRIPTION_STEP_INDEX = 3;

  const handleNext = useCallback(async () => {
    if (!validateStep(activeStep)) {
      setSnackbar({
        open: true,
        message: "Please fill all required fields correctly before proceeding.",
        severity: "warning",
      });
      return;
    }

    // Leaving the Description step with nothing written: try to generate a
    // grounded description from confirmed listing data now, so the seller
    // sees and can edit it on Review rather than it only ever being
    // generated silently at publish time (see createProperty's own
    // buildBilingualDescription fallback, which still covers this case if
    // this attempt fails or the seller skips past it too quickly to
    // finish) - never blocks advancing either way.
    if (
      activeStep === DESCRIPTION_STEP_INDEX &&
      !(formData.description || "").trim() &&
      !enhancingDescription
    ) {
      setEnhancingDescription(true);
      const result = await requestDescriptionFromBackend("");
      if (result.description) {
        setFormData((prev) => ({ ...prev, description: result.description }));
      }
      setEnhancingDescription(false);
    }

    const nextStepIndex = activeStep + 1;
    if (nextStepIndex < steps.length) {
      setActiveStep(nextStepIndex);
    }
  }, [
    activeStep,
    validateStep,
    formData.description,
    enhancingDescription,
    requestDescriptionFromBackend,
  ]);

  const handleBack = useCallback(() => {
    const prevStepIndex = activeStep - 1;
    if (prevStepIndex >= 0) {
      setActiveStep(prevStepIndex);
    }
  }, [activeStep]);

  const handleImageFileSelected = useCallback(
    async (file) => {
      console.log(
        "[useListingForm] handleImageFileSelected called with file:",
        file.name
      );
      if (!idToken) {
        console.error("[useListingForm] No idToken found for image upload.");
        setSnackbar({
          open: true,
          message: "Authentication session error. Please log in again.",
          severity: "error",
        });
        return;
      }
      if (imageUrls.length >= 10) {
        setSnackbar({
          open: true,
          message: "You can upload a maximum of 10 images.",
          severity: "warning",
        });
        return;
      }

      const tempId = `${file.name}-${Date.now()}`;
      setImageUploadStates((prev) => ({
        ...prev,
        [tempId]: {
          loading: true,
          error: null,
          url: null,
          fileName: file.name,
        },
      }));

      const imageFormData = new FormData();
      imageFormData.append("propertyImage", file);

      try {
        console.log(
          "[useListingForm] Attempting to upload image to backend route: /properties/upload-image"
        );
        const response = await axios.post(
          `${API_BASE_URL}/properties/upload-image`,
          imageFormData,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
              "Content-Type": "multipart/form-data",
            },
          }
        );
        console.log(
          "[useListingForm] Backend response for image upload:",
          response.data
        );
        if (response.data && response.data.imageUrl) {
          setImageUrls((prevUrls) => [...prevUrls, response.data.imageUrl]);
          setImageUploadStates((prev) => ({
            ...prev,
            [tempId]: {
              ...prev[tempId],
              loading: false,
              url: response.data.imageUrl,
            },
          }));
          if (errors.images) setErrors((prev) => ({ ...prev, images: null }));
        } else {
          throw new Error("Image URL not found in backend response.");
        }
      } catch (uploadError) {
        const errorMsg = uploadError.response
          ? JSON.stringify(uploadError.response.data)
          : uploadError.message;
        console.error(
          "[useListingForm] Error during image upload to backend:",
          errorMsg
        );
        setImageUploadStates((prev) => ({
          ...prev,
          [tempId]: {
            ...prev[tempId],
            loading: false,
            error:
              "Upload failed: " +
              (uploadError.response?.data?.message || "Network error"),
          },
        }));
        setSnackbar({
          open: true,
          message:
            "Image upload failed: " +
            (uploadError.response?.data?.message || "Check console"),
          severity: "error",
        });
      }
    },
    [idToken, imageUrls, errors.images]
  );

  const removeImageByUrl = useCallback((urlToRemove) => {
    console.log("[useListingForm] Removing image by URL:", urlToRemove);
    setImageUrls((prevUrls) => prevUrls.filter((url) => url !== urlToRemove));
    setImageUploadStates((prevStates) => {
      const newStates = { ...prevStates };
      Object.keys(newStates).forEach((key) => {
        if (newStates[key].url === urlToRemove) {
          delete newStates[key];
        }
      });
      return newStates;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    console.log("[useListingForm] handleSubmit called.");
    let allStepsValid = true;

    for (let i = 0; i < steps.length - 1; i++) {
      if (!validateStep(i)) {
        allStepsValid = false;
        setActiveStep(i);
        setSnackbar({
          open: true,
          message: `Please review Step ${i + 1}: ${steps[i]} for errors.`,
          severity: "error",
        });
        break;
      }
    }

    if (!allStepsValid) {
      console.log("[useListingForm] Form validation failed before submission.");
      return;
    }

    if (!idToken) {
      console.error("[useListingForm] handleSubmit: No idToken!");
      setSnackbar({
        open: true,
        message: "Authentication error. Please log in again.",
        severity: "error",
      });
      return;
    }
    const creatorEmail = user?.email;
    if (!creatorEmail) {
      console.error("[useListingForm] handleSubmit: User email not found!");
      setSnackbar({
        open: true,
        message: "User information is missing. Please log in again.",
        severity: "error",
      });
      return;
    }

    setLoadingSubmit(true);
    setSnackbar({ open: false });

    const finalBangladeshDetails = { ...formData.bangladeshDetails };
    if (finalBangladeshDetails.backupPower === "")
      finalBangladeshDetails.backupPower = "none"; //

    const finalData = {
      ...formData,
      bangladeshDetails: finalBangladeshDetails,
      features:
        formData.propertyType !== "land" &&
        formData.propertyType !== "commercial"
          ? features
          : {},
      images: imageUrls,
      createdBy: creatorEmail,
    };

    if (
      finalData.price !== undefined &&
      String(finalData.price).trim() !== ""
    ) {
      finalData.price = Number(finalData.price);
    } else {
    }

    if (finalData.area !== undefined && String(finalData.area).trim() !== "") {
      finalData.area = Number(finalData.area);
    } else if (String(finalData.area).trim() === "") {
      delete finalData.area;
    }

    // Only present when a real address-autocomplete suggestion was selected
    // (see handleAddressSelect) - omitted entirely otherwise so the backend
    // takes its existing geocode-from-text path exactly as before (see
    // getValidSubmittedCoordinates in propertyController.js).
    if (finalData.latitude == null || finalData.longitude == null) {
      delete finalData.latitude;
      delete finalData.longitude;
      delete finalData.geocodedAddress;
    }

    if (
      formData.propertyType === "land" ||
      formData.propertyType === "commercial"
    ) {
      delete finalData.bedrooms;
      delete finalData.bathrooms;
    } else {
      finalData.bedrooms =
        String(formData.bedrooms).trim() === "" ||
        isNaN(Number(formData.bedrooms))
          ? 0
          : Number(formData.bedrooms);
      finalData.bathrooms =
        String(formData.bathrooms).trim() === "" ||
        isNaN(Number(formData.bathrooms))
          ? 0
          : Number(formData.bathrooms);
    }

    console.log(
      "[useListingForm] Final data being submitted to /properties:",
      finalData
    );

    try {
      const createResponse = await axios.post(
        `${API_BASE_URL}/properties`,
        finalData,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      setSnackbar({
        open: true,
        message: "Property listed successfully!",
        severity: "success",
      });
      // Take the seller straight to the listing they just created, using
      // the SAME route every other "View Details" link in the app already
      // uses (PropertyCard.js, MapPage.js, PropertyInfoPanel.js, the
      // chatbot) - identical for every listing type (rent/buy/sold), no
      // type-based branching. createProperty's response is the full,
      // populated Property document, so _id is always present on success;
      // the /user-profile fallback below only matters defensively, in case
      // a future backend change ever omits it.
      const createdPropertyId = createResponse.data?._id;
      setTimeout(() => {
        navigate(
          createdPropertyId
            ? `/properties/details/${createdPropertyId}`
            : "/user-profile"
        );
      }, 1500);
    } catch (err) {
      const errorResponse = err.response;
      console.error(
        "Property submission error:",
        errorResponse ? errorResponse.data : err.message
      );

      let detailedErrorMessages = "";

      if (
        errorResponse?.data?.errors &&
        Array.isArray(errorResponse.data.errors)
      ) {
        detailedErrorMessages = errorResponse.data.errors
          .map((e) => `${e.path || "General"}: ${e.msg}`)
          .join("; ");
      }

      const errorMessage =
        errorResponse?.status === 401 || errorResponse?.status === 403
          ? `Authorization error (${errorResponse.status}). Please try logging in again.`
          : detailedErrorMessages ||
            errorResponse?.data?.message ||
            errorResponse?.data?.error ||
            "Property submission failed. Please check your input and try again.";
      setSnackbar({ open: true, message: errorMessage, severity: "error" });
    } finally {
      setLoadingSubmit(false);
    }
  }, [
    formData,
    features,
    user,
    idToken,
    navigate,
    validateStep,
    imageUrls,
    setActiveStep,
    setSnackbar,
    setLoadingSubmit,
  ]);

  const handleCloseSnackbar = useCallback((_, reason) => {
    if (reason === "clickaway") return;
    setSnackbar((prev) => ({ ...prev, open: false }));
  }, []);

  return {
    activeStep,
    steps,
    formData,
    features,
    imageUrls,
    imageUploadStates,
    errors,
    loadingSubmit,
    snackbar,
    handleChange,
    handleAddressTextChange,
    handleAddressSelect,
    handleFeatureChange,
    handleImageFileSelected,
    removeImageByUrl,
    handleNext,
    handleBack,
    handleSubmit,
    handleCloseSnackbar,
    validateStep,
    enhancingDescription,
    handleEnhanceDescription,
  };
};

export default useListingForm;
