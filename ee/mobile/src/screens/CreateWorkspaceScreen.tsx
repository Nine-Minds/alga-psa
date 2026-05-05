import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import type { RootStackParamList } from "../navigation/types";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { checkEmailExists, provisionFromPurchase, restorePurchase } from "../api/iap";
import {
  closeIapConnection,
  fetchIapProducts,
  finishIapTransaction,
  installPurchaseListeners,
  restoreIapPurchases,
  SOLO_MONTHLY_PRODUCT_ID,
  startSoloSubscription,
  type IapProduct,
} from "../iap/purchases";
import { createPendingMobileAuth } from "../auth/mobileAuth";
import { tryBuildHostedPathUrl } from "../urls/hostedUrls";
import { logger } from "../logging/logger";

/**
 * Generate a v4-style UUID for the Apple appAccountToken. Not cryptographically
 * strong but adequate: Apple only uses this value to tie a transaction back to
 * our server-side provisioning request.
 */
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type Status =
  | "idle"
  | "loading_products"
  | "checking_email"
  | "purchasing"
  | "provisioning"
  | "restoring";

export function CreateWorkspaceScreen() {
  const { t } = useTranslation("iap");
  const theme = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const config = useMemo(() => getAppConfig(), []);
  const baseUrl = config.ok ? config.baseUrl : null;

  const [status, setStatus] = useState<Status>("idle");
  const [product, setProduct] = useState<IapProduct | null>(null);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);

  /**
   * Track the appAccountToken we issued for the in-flight purchase so that
   * when the purchase-complete listener fires we can send it to the server.
   * We also latch the email/name/workspace that were in the form at the
   * moment Subscribe was tapped — if the user edits the form mid-purchase,
   * we still send the committed values.
   */
  const pendingPurchase = useRef<{
    appAccountToken: string;
    emailHint: string;
    firstName: string;
    lastName: string;
    workspaceName: string;
  } | null>(null);

  // Guard so the listener only handles a given purchase once.
  const handledTransactions = useRef<Set<string>>(new Set());

  const iosOnly = Platform.OS === "ios";

  /* ---------------- product catalog ---------------- */

  useEffect(() => {
    if (!iosOnly) return;
    let canceled = false;

    const loadProducts = async () => {
      setStatus("loading_products");
      setError(null);
      try {
        const products = await fetchIapProducts();
        if (canceled) return;
        const solo = products.find((p) => p.productId === SOLO_MONTHLY_PRODUCT_ID) ?? products[0];
        if (!solo) {
          setError(t("errors.noProducts", "Subscription is temporarily unavailable."));
        } else {
          setProduct(solo);
        }
      } catch (e) {
        if (canceled) return;
        logger.error("Failed to load IAP products", { error: e });
        setError(t("errors.loadProductsFailed", "Unable to contact the App Store."));
      } finally {
        if (!canceled) setStatus("idle");
      }
    };

    void loadProducts();
    return () => {
      canceled = true;
      // Leave the connection open for now — closing it would kill the
      // purchase listener. Connection is torn down on unmount below.
    };
  }, [iosOnly, t]);

  /* ---------------- purchase listener ---------------- */

  const handlePurchaseComplete = useCallback(
    async (purchase: any) => {
      const txId =
        purchase?.transactionIdentifierIOS ??
        purchase?.transactionId ??
        purchase?.originalTransactionIdentifierIOS ??
        "";
      if (!txId) {
        logger.warn("Purchase complete with no transaction ID", { purchase });
        return;
      }
      if (handledTransactions.current.has(String(txId))) {
        return;
      }
      handledTransactions.current.add(String(txId));

      const pending = pendingPurchase.current;
      if (!pending) {
        logger.warn("Purchase complete but no pending context — skipping", { txId });
        return;
      }
      if (!baseUrl) {
        setError(t("errors.noBaseUrl", "App is not configured."));
        return;
      }

      const originalTransactionId = String(
        purchase?.originalTransactionIdentifierIOS ??
          purchase?.transactionIdentifierIOS ??
          txId,
      );

      setStatus("provisioning");
      setError(null);
      try {
        const apiClient = createApiClient({
          baseUrl,
          getUserAgentTag: () => `mobile/${Platform.OS}/iap-provision`,
        });

        const pendingAuth = await createPendingMobileAuth();

        const result = await provisionFromPurchase(apiClient, {
          originalTransactionId,
          appAccountToken: pending.appAccountToken,
          emailHint: pending.emailHint,
          firstName: pending.firstName || undefined,
          lastName: pending.lastName || undefined,
          workspaceName: pending.workspaceName || undefined,
          state: pendingAuth.state,
        });

        if (!result.ok) {
          setError(
            t(
              "errors.provisionFailed",
              "Purchase went through but we couldn't provision your workspace. Please contact support.",
            ),
          );
          setStatus("idle");
          return;
        }

        // Server accepted the purchase — safe to tell StoreKit we're done so
        // it doesn't re-deliver the transaction on next launch.
        try {
          await finishIapTransaction(purchase);
        } catch (e) {
          logger.warn("finishTransaction failed (non-fatal)", { error: e });
        }

        // Hand off to the existing OTT exchange flow.
        navigation.navigate("AuthCallback", {
          ott: result.data.ott,
          state: pendingAuth.state,
        });
      } catch (e) {
        logger.error("Provisioning threw", { error: e });
        setError(
          t(
            "errors.provisionFailed",
            "Purchase went through but we couldn't provision your workspace. Please contact support.",
          ),
        );
        setStatus("idle");
      }
    },
    [baseUrl, navigation, t],
  );

  const handlePurchaseError = useCallback(
    (err: any) => {
      // Swallow the common "user cancelled" error quietly.
      const code = err?.code;
      if (code === "E_USER_CANCELLED" || code === "E_USER_ERROR") {
        setStatus("idle");
        return;
      }
      logger.error("IAP purchase error", { error: err });
      setError(
        err?.message
          ? String(err.message)
          : t("errors.purchaseFailed", "Purchase could not be completed."),
      );
      setStatus("idle");
    },
    [t],
  );

  useEffect(() => {
    if (!iosOnly) return;
    const teardown = installPurchaseListeners({
      onPurchaseComplete: handlePurchaseComplete,
      onPurchaseError: handlePurchaseError,
    });
    return () => {
      teardown();
    };
  }, [iosOnly, handlePurchaseComplete, handlePurchaseError]);

  // Tear down the StoreKit connection on unmount to free native resources.
  useEffect(() => {
    return () => {
      void closeIapConnection();
    };
  }, []);

  /* ---------------- actions ---------------- */

  const onSubscribe = async () => {
    setError(null);
    if (!iosOnly) {
      setError(t("errors.iosOnly", "Subscriptions are only available on iOS."));
      return;
    }
    if (!baseUrl) {
      setError(t("errors.noBaseUrl", "App is not configured."));
      return;
    }
    const trimmedEmail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError(t("errors.invalidEmail", "Enter a valid email address."));
      return;
    }

    // Pre-purchase email check: bail before StoreKit if a tenant already
    // exists for this email, so the user doesn't get charged by Apple and
    // then fail to provision into a duplicate workspace. We do this BEFORE
    // the !product guard so user-input errors are surfaced regardless of
    // StoreKit product fetch state.
    setStatus("checking_email");
    try {
      const apiClient = createApiClient({
        baseUrl,
        getUserAgentTag: () => `mobile/${Platform.OS}/iap-check-email`,
      });
      const checkResult = await checkEmailExists(apiClient, { email: trimmedEmail });
      if (!checkResult.ok) {
        setError(
          t(
            "errors.checkEmailFailed",
            "Unable to verify email availability. Please try again.",
          ),
        );
        setStatus("idle");
        return;
      }
      if (checkResult.data.exists) {
        setError(
          t(
            "errors.emailAlreadyExists",
            "An account already exists for this email. Please sign in instead, or use a different email address.",
          ),
        );
        setStatus("idle");
        return;
      }
    } catch (e) {
      logger.error("Email availability check threw", { error: e });
      setError(
        t(
          "errors.checkEmailFailed",
          "Unable to verify email availability. Please try again.",
        ),
      );
      setStatus("idle");
      return;
    }

    if (!product) {
      setError(t("errors.noProducts", "Subscription is temporarily unavailable."));
      setStatus("idle");
      return;
    }

    const appAccountToken = uuidv4();
    pendingPurchase.current = {
      appAccountToken,
      emailHint: trimmedEmail,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      workspaceName: workspaceName.trim(),
    };

    setStatus("purchasing");
    try {
      await startSoloSubscription({ appAccountToken });
      // From here the purchase listener takes over.
    } catch (e) {
      logger.error("Failed to start subscription", { error: e });
      setError(t("errors.purchaseFailed", "Purchase could not be completed."));
      setStatus("idle");
    }
  };

  const onRestore = async () => {
    setError(null);
    if (!iosOnly) return;
    if (!baseUrl) {
      setError(t("errors.noBaseUrl", "App is not configured."));
      return;
    }

    setStatus("restoring");
    try {
      const restored = await restoreIapPurchases();
      const solo = restored.find((p) => p.productId === SOLO_MONTHLY_PRODUCT_ID);
      if (!solo) {
        setError(t("errors.nothingToRestore", "No prior purchase was found on this Apple ID."));
        setStatus("idle");
        return;
      }

      const apiClient = createApiClient({
        baseUrl,
        getUserAgentTag: () => `mobile/${Platform.OS}/iap-restore`,
      });
      const pendingAuth = await createPendingMobileAuth();

      const result = await restorePurchase(apiClient, {
        originalTransactionId: solo.originalTransactionId,
        state: pendingAuth.state,
      });

      if (!result.ok) {
        if (result.status === 404) {
          setError(
            t(
              "errors.restoreNotProvisioned",
              "This purchase hasn't been used to create a workspace yet. Please use 'Subscribe' instead.",
            ),
          );
        } else {
          setError(t("errors.restoreFailed", "Unable to restore your purchase."));
        }
        setStatus("idle");
        return;
      }

      navigation.navigate("AuthCallback", {
        ott: result.data.ott,
        state: pendingAuth.state,
      });
    } catch (e) {
      logger.error("Restore threw", { error: e });
      setError(t("errors.restoreFailed", "Unable to restore your purchase."));
      setStatus("idle");
    }
  };

  const openTerms = () => {
    const url = tryBuildHostedPathUrl(baseUrl, "/static/master_terms");
    if (url) void Linking.openURL(url);
  };
  const openPrivacy = () => {
    const url = tryBuildHostedPathUrl(baseUrl, "/static/privacy_policy");
    if (url) void Linking.openURL(url);
  };

  /* ---------------- render ---------------- */

  if (!iosOnly) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: theme.spacing.xl,
          backgroundColor: theme.colors.background,
        }}
      >
        <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center" }}>
          {t(
            "androidNotice",
            "Subscriptions from this app are only available on iOS. Please create a workspace from our website.",
          )}
        </Text>
      </View>
    );
  }

  const busy = status !== "idle";
  const busyLabel =
    status === "loading_products"
      ? t("status.loadingProducts", "Loading…")
      : status === "checking_email"
        ? t("status.checkingEmail", "Checking email…")
        : status === "purchasing"
          ? t("status.purchasing", "Processing payment…")
          : status === "provisioning"
            ? t("status.provisioning", "Creating your workspace…")
            : status === "restoring"
              ? t("status.restoring", "Restoring…")
              : "";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: theme.spacing.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={{ ...theme.typography.title, color: theme.colors.text, textAlign: "center" }}>
        {t("title", "Create your workspace")}
      </Text>
      <Text
        style={{
          ...theme.typography.body,
          color: theme.colors.textSecondary,
          textAlign: "center",
          marginTop: theme.spacing.md,
        }}
      >
        {t(
          "subtitle",
          "AlgaPSA Solo is a one-person plan for independent MSPs. Subscribe to create your workspace and start managing your clients, tickets, and invoices.",
        )}
      </Text>

      {product ? (
        <View
          style={{
            marginTop: theme.spacing.lg,
            padding: theme.spacing.lg,
            backgroundColor: theme.colors.card,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 12,
          }}
        >
          <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>
            {product.title}
          </Text>
          <Text
            style={{
              ...theme.typography.body,
              color: theme.colors.textSecondary,
              marginTop: theme.spacing.sm,
            }}
          >
            {product.description}
          </Text>
          <Text
            style={{
              ...theme.typography.title,
              color: theme.colors.text,
              marginTop: theme.spacing.md,
            }}
          >
            {product.localizedPrice}
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {" "}
              / {t("perMonth", "month")}
            </Text>
          </Text>
        </View>
      ) : null}

      <View style={{ marginTop: theme.spacing.lg }}>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
          {t("form.email", "Email")}
        </Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          placeholder="you@example.com"
          placeholderTextColor={theme.colors.textSecondary}
          accessibilityLabel={t("form.email", "Email")}
          style={{
            marginTop: theme.spacing.xs,
            padding: theme.spacing.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 8,
            color: theme.colors.text,
            backgroundColor: theme.colors.card,
          }}
        />

        <View style={{ flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t("form.firstName", "First name")}
            </Text>
            <TextInput
              value={firstName}
              onChangeText={setFirstName}
              editable={!busy}
              autoCapitalize="words"
              placeholderTextColor={theme.colors.textSecondary}
              style={{
                marginTop: theme.spacing.xs,
                padding: theme.spacing.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 8,
                color: theme.colors.text,
                backgroundColor: theme.colors.card,
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t("form.lastName", "Last name")}
            </Text>
            <TextInput
              value={lastName}
              onChangeText={setLastName}
              editable={!busy}
              autoCapitalize="words"
              placeholderTextColor={theme.colors.textSecondary}
              style={{
                marginTop: theme.spacing.xs,
                padding: theme.spacing.md,
                borderWidth: 1,
                borderColor: theme.colors.border,
                borderRadius: 8,
                color: theme.colors.text,
                backgroundColor: theme.colors.card,
              }}
            />
          </View>
        </View>

        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.md }}>
          {t("form.companyName", "Company name (optional)")}
        </Text>
        <TextInput
          value={workspaceName}
          onChangeText={setWorkspaceName}
          editable={!busy}
          placeholder={t("form.companyPlaceholder", "My MSP")}
          placeholderTextColor={theme.colors.textSecondary}
          style={{
            marginTop: theme.spacing.xs,
            padding: theme.spacing.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 8,
            color: theme.colors.text,
            backgroundColor: theme.colors.card,
          }}
        />
      </View>

      <View style={{ marginTop: theme.spacing.xl }}>
        <PrimaryButton
          onPress={() => void onSubscribe()}
          disabled={busy /* TEMP: removed `|| !product` so the email check can be tested before Apple makes the product available; revert before merging */}
          accessibilityLabel={t("subscribe", "Subscribe")}
        >
          {busy ? busyLabel : t("subscribe", "Subscribe")}
        </PrimaryButton>

        {busy ? (
          <View style={{ alignItems: "center", marginTop: theme.spacing.md }}>
            <ActivityIndicator />
          </View>
        ) : null}

        <View style={{ alignItems: "center", marginTop: theme.spacing.md }}>
          <Text
            onPress={busy ? undefined : () => void onRestore()}
            accessibilityRole="button"
            accessibilityLabel={t("restore", "Restore Purchases")}
            style={{
              ...theme.typography.body,
              color: busy ? theme.colors.textSecondary : theme.colors.secondary,
              textAlign: "center",
              paddingVertical: theme.spacing.sm,
            }}
          >
            {t("restore", "Restore Purchases")}
          </Text>
        </View>
      </View>

      {error ? (
        <Text
          style={{
            ...theme.typography.body,
            color: theme.colors.secondary,
            textAlign: "center",
            marginTop: theme.spacing.md,
          }}
        >
          {error}
        </Text>
      ) : null}

      <Text
        style={{
          ...theme.typography.caption,
          color: theme.colors.textSecondary,
          textAlign: "center",
          marginTop: theme.spacing.xl,
        }}
      >
        {t(
          "disclosure",
          "Payment will be charged to your Apple ID. Subscription automatically renews unless cancelled at least 24 hours before the end of the current period. Manage or cancel in your Apple ID Settings.",
        )}
      </Text>

      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          marginTop: theme.spacing.md,
          gap: theme.spacing.lg,
        }}
      >
        <Text
          onPress={openTerms}
          accessibilityRole="link"
          accessibilityLabel={t("termsOfUse", "Terms of Use")}
          style={{ ...theme.typography.caption, color: theme.colors.secondary }}
        >
          {t("termsOfUse", "Terms of Use (EULA)")}
        </Text>
        <Text
          onPress={openPrivacy}
          accessibilityRole="link"
          accessibilityLabel={t("privacyPolicy", "Privacy Policy")}
          style={{ ...theme.typography.caption, color: theme.colors.secondary }}
        >
          {t("privacyPolicy", "Privacy Policy")}
        </Text>
      </View>
    </ScrollView>
  );
}
