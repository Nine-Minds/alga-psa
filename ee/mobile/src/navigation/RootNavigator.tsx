import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Platform } from "react-native";
import type { RootStackParamList } from "./types";
import { DrawerNavigator } from "./DrawerNavigator";
import { goBackOrTabs, headerBackOptions } from "./HeaderBackButton";
import { SignInScreen } from "../screens/SignInScreen";
import { ServerEntryScreen } from "../screens/ServerEntryScreen";
import { TicketDetailScreen } from "../screens/TicketDetailScreen";
import { CreateTicketScreen } from "../screens/CreateTicketScreen";
import { AuthCallbackScreen } from "../screens/AuthCallbackScreen";
import { CreateWorkspaceScreen } from "../screens/CreateWorkspaceScreen";
import { AccountDeletionScreen } from "../screens/AccountDeletionScreen";
import { MutedUsersScreen } from "../screens/MutedUsersScreen";
import { ClientDetailScreen } from "../screens/ClientDetailScreen";
import { ContactDetailScreen } from "../screens/ContactDetailScreen";
import { ProjectTaskDetailScreen } from "../screens/ProjectTaskDetailScreen";
import { WorkflowTaskDetailScreen } from "../screens/WorkflowTaskDetailScreen";
import { StockProductDetailScreen } from "../screens/StockProductDetailScreen";
import { StockUnitDetailScreen } from "../screens/StockUnitDetailScreen";
import { InventoryReceiveScreen } from "../screens/InventoryReceiveScreen";
import { InventoryAdjustScreen } from "../screens/InventoryAdjustScreen";
import { CountSessionScreen } from "../screens/CountSessionScreen";
import { PurchaseOrderDetailScreen } from "../screens/PurchaseOrderDetailScreen";
import { OpportunityDetailScreen } from "../screens/OpportunityDetailScreen";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ui/ThemeContext";
import { useNotifications } from "../notifications/useNotifications";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator({ isSignedIn }: { isSignedIn: boolean }) {
  const theme = useTheme();
  const { t: tAuth } = useTranslation("auth");
  const { t: tCommon } = useTranslation("common");
  const { t: tTickets } = useTranslation("tickets");
  const { t: tSettings } = useTranslation("settings");
  const { t: tClients } = useTranslation("clients");
  const { t: tContacts } = useTranslation("contacts");
  const { t: tUserActivities } = useTranslation("userActivities");
  const { t: tInventory } = useTranslation("inventory");
  const { t: tOpportunities } = useTranslation("opportunities");
  const backLabel = tCommon("back", "Back");

  // Register push token and handle notification taps (no-op when feature flag is off)
  useNotifications();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.card,
        },
        headerTintColor: theme.colors.text,
        headerTitleStyle: {
          color: theme.colors.text,
          fontWeight: "600" as const,
        },
        contentStyle: {
          backgroundColor: theme.colors.background,
        },
      }}
    >
      {isSignedIn ? (
        <>
          <Stack.Screen name="Tabs" component={DrawerNavigator} options={{ headerShown: false }} />
          <Stack.Screen
            name="AuthCallback"
            component={AuthCallbackScreen}
            options={{ title: tAuth("callback.title", "Signing in") }}
          />
          <Stack.Screen
            name="AccountDeletion"
            component={AccountDeletionScreen}
            options={({ navigation }) => ({
              title: tAuth("accountDeletion.title", "Delete Account"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="MutedUsers"
            component={MutedUsersScreen}
            options={({ navigation }) => ({
              title: tSettings("mutedUsers.title", "Muted users"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="CreateTicket"
            component={CreateTicketScreen}
            options={({ navigation }) => ({
              title: tTickets("create.title", "New Ticket"),
              ...(Platform.OS === "android" ? { headerTitleAlign: "left" as const } : {}),
              ...headerBackOptions(tTickets("list.title", "Tickets"), goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="TicketDetail"
            component={TicketDetailScreen}
            options={({ navigation }) => ({
              title: tTickets("list.title", "Tickets"),
              ...(Platform.OS === "android" ? { headerTitleAlign: "left" as const } : {}),
              ...headerBackOptions(tTickets("list.title", "Tickets"), goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="ClientDetail"
            component={ClientDetailScreen}
            options={({ navigation, route }) => ({
              title: route.params.clientName ?? tClients("detail.title", "Client"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="ContactDetail"
            component={ContactDetailScreen}
            options={({ navigation, route }) => ({
              title: route.params.contactName ?? tContacts("detail.title", "Contact"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="ProjectTaskDetail"
            component={ProjectTaskDetailScreen}
            options={({ navigation }) => ({
              title: tUserActivities("projectTask.title", "Task"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="WorkflowTaskDetail"
            component={WorkflowTaskDetailScreen}
            options={({ navigation }) => ({
              title: tUserActivities("workflowTask.title", "Workflow task"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="StockProductDetail"
            component={StockProductDetailScreen}
            options={({ navigation, route }) => ({
              title: route.params.serviceName ?? tInventory("stock.title", "Stock"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="StockUnitDetail"
            component={StockUnitDetailScreen}
            options={({ navigation }) => ({
              title: tInventory("unit.title", "Unit"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="InventoryReceive"
            component={InventoryReceiveScreen}
            options={({ navigation }) => ({
              title: tInventory("receive.title", "Receive stock"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="InventoryAdjust"
            component={InventoryAdjustScreen}
            options={({ navigation }) => ({
              title: tInventory("adjust.title", "Adjust stock"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="CountSession"
            component={CountSessionScreen}
            options={({ navigation, route }) => ({
              title: route.params.locationName ?? tInventory("counts.title", "Counts"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="PurchaseOrderDetail"
            component={PurchaseOrderDetailScreen}
            options={({ navigation, route }) => ({
              title: route.params.poNumber ?? tInventory("pos.title", "Purchase orders"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
          <Stack.Screen
            name="OpportunityDetail"
            component={OpportunityDetailScreen}
            options={({ navigation, route }) => ({
              title: route.params.title ?? tOpportunities("title", "Opportunities"),
              ...headerBackOptions(backLabel, goBackOrTabs(navigation)),
            })}
          />
        </>
      ) : (
        <>
          <Stack.Screen
            name="SignIn"
            component={SignInScreen}
            options={{ title: tAuth("signIn.title", "Sign in") }}
          />
          <Stack.Screen
            name="ServerEntry"
            component={ServerEntryScreen}
            options={{ title: tAuth("serverEntry.title", "Server") }}
          />
          {Platform.OS === "ios" ? (
            <Stack.Screen
              name="CreateWorkspace"
              component={CreateWorkspaceScreen}
              options={{ title: tAuth("createWorkspace.title", "Create workspace") }}
            />
          ) : null}
          <Stack.Screen
            name="AuthCallback"
            component={AuthCallbackScreen}
            options={{ title: tAuth("callback.title", "Signing in") }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
