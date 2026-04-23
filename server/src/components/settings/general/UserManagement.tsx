'use client'


import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import UserList from './UserList';
import { getAllUsers, getUserWithRoles, getMSPRoles, getClientPortalRoles, getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { addUser } from '@alga-psa/users/actions';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { getAllClients } from '@alga-psa/clients/actions';
import { addContact, getContactsByClient, getAllContacts, getContactsEligibleForInvitation } from '@alga-psa/clients/actions';
import { sendPortalInvitation, createClientPortalUser } from '@alga-psa/client-portal/actions';
import type { PortalInvitationErrorCode } from '@alga-psa/portal-shared/types';
import { getTenantPortalLoginLink } from '@alga-psa/client-portal/actions';

const PORTAL_INVITE_ERROR_KEYS: Partial<Record<PortalInvitationErrorCode, string>> = {
  PERMISSION_DENIED_INVITE: 'users.messages.error.permissionDeniedInvite',
  PERMISSION_DENIED_CREATE: 'users.messages.error.permissionDeniedCreate',
  EMAIL_NOT_CONFIGURED: 'users.messages.error.emailNotConfigured',
  CONTACT_NOT_FOUND: 'users.messages.error.contactNotFound',
  CONTACT_MISSING_EMAIL: 'users.messages.error.contactMissingEmailGeneric',
  CONTACT_INVALID_EMAIL: 'users.messages.error.contactInvalidEmail',
  USER_EXISTS_FOR_CONTACT: 'users.messages.error.portalUserExistsForContact',
  PORTAL_USER_ALREADY_EXISTS: 'users.messages.error.portalUserExists',
  NO_DEFAULT_CLIENT: 'users.messages.error.noDefaultClient',
  NO_DEFAULT_LOCATION: 'users.messages.error.noDefaultLocation',
  NO_LOCATION_EMAIL: 'users.messages.error.noLocationEmail',
  BASE_URL_NOT_CONFIGURED: 'users.messages.error.noBaseUrl',
  INVITATION_FAILED: 'users.messages.error.sendInvitation',
  PASSWORD_TOO_SHORT: 'users.messages.error.passwordTooShort',
  CREATE_USER_FAILED: 'users.messages.error.createClientPortalUser'
};
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { IUser, IRole } from '@alga-psa/types';
import { IClient } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import ViewSwitcher, { ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@alga-psa/ui/components/Tabs';
import { Search, Eye, EyeOff } from 'lucide-react';
import { getLicenseUsageAction } from '@alga-psa/licensing/actions';
import { LicenseUsage } from '@alga-psa/licensing/lib/get-license-usage';
import { validateContactName, validateEmailAddress, validatePassword, getPasswordRequirements } from '@alga-psa/validation';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import OrgChart from './org-chart/OrgChart';
import { QuickAddContact } from '@alga-psa/clients/components';
import { useTier } from '@/context/TierContext';

const UserManagement = (): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');

  const translatePortalInvitationError = (
    result: { error?: string; errorCode?: PortalInvitationErrorCode },
    defaultKey: string
  ): string => {
    if (result.errorCode) {
      const key = PORTAL_INVITE_ERROR_KEYS[result.errorCode];
      if (key) {
        return t(key, { defaultValue: result.error ?? undefined });
      }
    }
    return result.error || t(defaultKey);
  };
  const [users, setUsers] = useState<IUser[]>([]);
  const [roles, setRoles] = useState<IRole[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientClientTypeFilter, setClientClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewUserForm, setShowNewUserForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pwdReq, setPwdReq] = useState({minLength:false,hasUpper:false,hasLower:false,hasNumber:false,hasSpecial:false});
  const [portalType, setPortalType] = useState<'msp' | 'client'>('msp');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [isQuickAddContactOpen, setIsQuickAddContactOpen] = useState(false);
  const [newUser, setNewUser] = useState({ 
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: '',
    clientId: '',
    reportsTo: ''
  });
  const [requirePwdChange, setRequirePwdChange] = useState(false);
  const [licenseUsage, setLicenseUsage] = useState<LicenseUsage | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    first_name: string[];
    last_name: string[];
    email: string[];
  }>({
    first_name: [],
    last_name: [],
    email: []
  });
  const [contactValidationError, setContactValidationError] = useState<string | null>(null);
  const [isCopyingPortalLink, setIsCopyingPortalLink] = useState(false);
  const [userView, setUserView] = useState<'list' | 'org'>('list');
  const { enabled: isTeamsV2Enabled } = useFeatureFlag('teams-v2', { defaultValue: false });
  const { isSolo } = useTier();
  const soloMspUserLimitReached = portalType === 'msp' && isSolo && (licenseUsage?.used ?? 0) >= 1;
  const soloMspLimitMessage = 'Solo plan is limited to 1 user. Upgrade to Pro to add more users.';

  const extractErrorMessage = (error: unknown): string => {
    if (typeof error === 'string') {
      return error.trim();
    }
    if (error instanceof Error) {
      return error.message.trim();
    }
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      return (error as { message: string }).message.trim();
    }
    return '';
  };

  const normalizeCreateUserError = (error: unknown): string => {
    const rawMessage = extractErrorMessage(error);
    if (!rawMessage) {
      return t('users.messages.error.createUser');
    }

    if (rawMessage.includes('EMAIL_EXISTS:') || rawMessage.includes('VALIDATION_ERROR:')) {
      return rawMessage.replace('EMAIL_EXISTS:', '').replace('VALIDATION_ERROR:', '').trim();
    }

    if (/already exists|duplicate key value|unique constraint/i.test(rawMessage)) {
      if (rawMessage.includes('already exists for this contact or email address')) {
        return t('users.messages.error.portalUserExists');
      }
      if (rawMessage.includes('already exists for this contact')) {
        return t('users.messages.error.portalUserExistsForContact');
      }
      return t('users.messages.error.emailAlreadyInUse');
    }

    if (/cannot assign/i.test(rawMessage)) {
      return t('users.messages.error.selectAppropriateRole');
    }

    return rawMessage;
  };

  const reportCreateUserError = (error: unknown): void => {
    const message = normalizeCreateUserError(error);
    toast.error(message);
    setError(message);
  };

  useEffect(() => {
    setLoading(true);
    fetchUsers();
    fetchRoles();
    fetchLicenseUsage();
    if (portalType === 'client') {
      fetchClients();
      fetchContacts();
    }
  }, [portalType]);

  useEffect(() => {
    if (!isTeamsV2Enabled || portalType !== 'msp') {
      setUserView('list');
    }
  }, [isTeamsV2Enabled, portalType]);

  useEffect(() => {
    if (portalType === 'client') {
      fetchContacts();
    }
    setSelectedContactId(null);
  }, [selectedClientId]);

  useEffect(() => {
    if (portalType === 'client') {
      fetchContacts();
    }
  }, [newUser.password]);

  // Show live password requirements feedback when typing
  useEffect(() => {
    const pw = newUser.password || '';
    setPwdReq(getPasswordRequirements(pw));
  }, [newUser.password]);

  // Validation functions
  const validateField = (fieldName: keyof typeof fieldErrors, value: string) => {
    let error: string | null = null;
    let errors: string[] = [];
    
    switch (fieldName) {
      case 'first_name':
        error = validateContactName(value);
        if (error) errors = [error];
        break;
      case 'last_name':
        error = validateContactName(value);
        if (error) errors = [error];
        break;
      case 'email':
        error = validateEmailAddress(value);
        if (error) errors = [error];
        break;
      default:
        errors = [];
    }
    
    setFieldErrors(prev => ({
      ...prev,
      [fieldName]: errors
    }));
    
    return errors.length === 0;
  };

  const validateAllFields = () => {
    const firstNameValid = validateField('first_name', newUser.firstName);
    const lastNameValid = validateField('last_name', newUser.lastName);
    const emailValid = validateField('email', newUser.email);
    
    return firstNameValid && lastNameValid && emailValid;
  };

  const handleFieldChange = (fieldName: keyof typeof fieldErrors, value: string) => {
    // Update the user state using the camelCase property names
    const userFieldMap = {
      first_name: 'firstName',
      last_name: 'lastName',
      email: 'email'
    } as const;

    const userField = userFieldMap[fieldName];
    setNewUser(prev => ({ ...prev, [userField]: value }));

    // Clear existing errors when user starts typing (but don't validate yet)
    if (fieldErrors[fieldName].length > 0) {
      setFieldErrors(prev => ({
        ...prev,
        [fieldName]: []
      }));
    }
  };

  const fetchLicenseUsage = async (): Promise<void> => {
    if (portalType === 'msp') {
      try {
        const result = await getLicenseUsageAction();
        if (result.success && result.data) {
          setLicenseUsage(result.data);
        }
      } catch (err) {
        console.error('Error fetching license usage:', err);
      }
    }
  };

  const handleCopyPortalLink = async (): Promise<void> => {
    if (isCopyingPortalLink) {
      return;
    }

    try {
      setIsCopyingPortalLink(true);
      const linkResult = await getTenantPortalLoginLink();
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(linkResult.url);
        toast.success(
          linkResult.source === 'vanity'
            ? t('users.messages.success.copiedVanityLink')
            : t('users.messages.success.copiedCanonicalLink')
        );
      } else {
        toast.error(t('users.messages.error.clipboardUnavailable'));
      }
    } catch (error) {
      handleError(error, t('users.messages.error.copyPortalLink'));
    } finally {
      setIsCopyingPortalLink(false);
    }
  };

  const fetchUsers = async (): Promise<void> => {
    try {
      const fetchedUsers = await getAllUsers(true);
      console.log('All fetched users:', fetchedUsers);
      
      // Filter users based on portal type
      const filteredByType = portalType === 'msp' 
        ? fetchedUsers.filter(user => user.user_type === 'internal' || !user.user_type)
        : fetchedUsers.filter(user => user.user_type === 'client');
      
      console.log(`Filtered ${portalType} users:`, filteredByType);
      
      const sortedUsers = [...filteredByType].sort((a, b) =>
        (a.first_name || '').toLowerCase().localeCompare((b.first_name || '').toLowerCase())
      );
      setUsers(sortedUsers);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError(t('users.messages.error.fetchUsers'));
      setLoading(false);
    }
  };

  const fetchRoles = async (): Promise<void> => {
    try {
      const fetchedRoles = portalType === 'msp' 
        ? await getMSPRoles()
        : await getClientPortalRoles();
      
      console.log(`Fetched ${portalType} roles:`, fetchedRoles);
      setRoles(fetchedRoles);

      // Set default role to the first role in the list
      if (fetchedRoles.length > 0) {
        setNewUser(prevState => ({ ...prevState, role: fetchedRoles[0].role_id }));
      } else {
        console.warn(`No ${portalType} roles found`);
      }
    } catch (err) {
      console.error('Error fetching roles:', err);
      setError(t('users.messages.error.fetchRoles'));
    }
  };

  const fetchClients = async (): Promise<void> => {
    try {
      const fetchedClients = await getAllClients();
      setClients(fetchedClients);
    } catch (err) {
      console.error('Error fetching clients:', err);
      setError(t('users.messages.error.fetchClients'));
    }
  };

  
const fetchContacts = async (): Promise<void> => {
    try {
      const invitationMode = portalType === 'client' && !newUser.password;
      if (invitationMode) {
        const cs = await getContactsEligibleForInvitation(selectedClientId || undefined, 'active' as any);
        setContacts(cs);
      } else {
        if (selectedClientId) {
          const cs = await getContactsByClient(selectedClientId, 'active' as any);
          setContacts(cs);
        } else {
          const cs = await getAllContacts('active' as any);
          setContacts(cs);
        }
      }
    } catch (err) {
      console.error('Error fetching contacts:', err);
      setContacts([]);
    }
  };

  const filteredUsers = users.filter(user => {
    const isStatusMatch =
      filterStatus === 'all' ||
      (filterStatus === 'active' && !user.is_inactive) ||
      (filterStatus === 'inactive' && user.is_inactive);

    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
    const isNameMatch = fullName.includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());

    return isStatusMatch && isNameMatch;
  });

  const handleCreateUser = async () => {
    try {
      // Clear any previous errors
      setError(null);
      
      // Validate all fields first
      const fieldsValid = validateAllFields();
      if (!fieldsValid) {
        setError(t('users.messages.error.fixValidationErrors'));
        return;
      }
      
      // Validate required fields based on portal type
      if (portalType === 'msp') {
        if (!newUser.firstName || !newUser.lastName || !newUser.email || !newUser.password) {
          setError(t('users.messages.error.fillRequiredFields'));
          return;
        }
      } else {
        // For client portal, password is optional (they'll set it via invitation)
        if (!newUser.firstName || !newUser.lastName || !newUser.email) {
          setError(t('users.messages.error.fillRequiredFields'));
          return;
        }
      }

      if (portalType === 'client') {
        if (!newUser.password) {
          // Check for validation errors before sending invitation
          if (contactValidationError) {
            toast.error(t('users.messages.error.fixValidationBeforeInvitation'));
            return;
          }
          
          if (selectedContactId) {
            try {
              const invitationResult = await sendPortalInvitation(selectedContactId);
              if (invitationResult.success) {
                toast.success(t('users.messages.success.portalInvitationSent'));
              } else {
                toast(translatePortalInvitationError(invitationResult, 'users.messages.error.sendInvitation'), { icon: '⚠️', duration: 5000 });
              }
            } catch (inviteError) {
              toast(t('users.messages.error.sendInvitationManual'), { icon: '⚠️', duration: 5000 });
            }
          } else {
            try {
              const contactResult = await addContact({
                full_name: `${newUser.firstName} ${newUser.lastName}`,
                email: newUser.email,
                client_id: newUser.clientId || undefined,
                is_inactive: false
              });
              if (!contactResult.success) {
                const errorMsg = normalizeCreateUserError(contactResult.error);
                handleError(new Error(contactResult.error), errorMsg);
                setError(errorMsg);
                return;
              }

              const contact = contactResult.contact;
              try {
                const invitationResult = await sendPortalInvitation(contact.contact_name_id);
                if (invitationResult.success) {
                  toast.success(t('users.messages.success.portalInvitationSent'));
                } else {
                  toast(translatePortalInvitationError(invitationResult, 'users.messages.error.sendInvitation'), { icon: '⚠️', duration: 5000 });
                }
              } catch (inviteError) {
                toast(t('users.messages.error.sendInvitationManual'), { icon: '⚠️', duration: 5000 });
              }
            } catch (contactError: any) {
              // Handle contact creation errors
              let errorMsg: string;
              if (contactError.message?.includes('EMAIL_EXISTS:')) {
                errorMsg = contactError.message.replace('EMAIL_EXISTS:', '').trim();
              } else if (contactError.message?.includes('VALIDATION_ERROR:')) {
                errorMsg = contactError.message.replace('VALIDATION_ERROR:', '').trim();
              } else {
                errorMsg = 'Failed to create contact: ' + (contactError.message || 'Unknown error');
              }
              handleError(contactError, errorMsg);
              setError(errorMsg);
              return; // Stop execution to prevent further processing
            }
          }
          await fetchUsers();
        } else {
          // Use unified password validation
          const passwordError = validatePassword(newUser.password);
          if (passwordError) {
            toast.error(passwordError);
            return;
          }
          const result = await createClientPortalUser(
            selectedContactId
              ? { password: newUser.password, contactId: selectedContactId, roleId: newUser.role, requirePasswordChange: requirePwdChange }
              : { password: newUser.password, contact: { email: newUser.email, fullName: `${newUser.firstName} ${newUser.lastName}`, clientId: newUser.clientId || '', isClientAdmin: false }, roleId: newUser.role, requirePasswordChange: requirePwdChange }
          );
          if (result.success) {
            toast.success(t('users.messages.success.clientPortalUserCreated'));
          } else {
            const message = translatePortalInvitationError(result, 'users.messages.error.createClientPortalUser');
            toast.error(message);
            setError(message);
            return;
          }
          await fetchUsers();
        }
      } else {
        // Create MSP user
        const result = await addUser({
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          email: newUser.email,
          password: newUser.password,
          roleId: newUser.role || (roles.length > 0 ? roles[0].role_id : undefined),
          reportsTo: newUser.reportsTo || undefined
        });

        if (!result.success) {
          const keysByCode: Record<typeof result.code, string> = {
            ROLE_REQUIRED: 'users.messages.error.roleRequired',
            INVALID_ROLE: 'users.messages.error.invalidRole',
            ROLE_MSP_NOT_ALLOWED_FOR_CLIENT: 'users.messages.error.selectAppropriateRole',
            ROLE_CLIENT_NOT_ALLOWED_FOR_MSP: 'users.messages.error.selectAppropriateRole',
            EMAIL_ALREADY_EXISTS: 'users.messages.error.emailAlreadyInUse',
            LICENSE_LIMIT_REACHED: 'users.messages.error.licenseLimitReached',
            SOLO_PLAN_LIMIT: 'users.messages.error.soloPlanLimit',
          };
          const message = t(keysByCode[result.code], { defaultValue: result.error });
          toast.error(message);
          setError(message);
          return;
        }

        // Fetch the updated user with roles
        const updatedUser = await getUserWithRoles(result.user.user_id);
        if (updatedUser) {
          setUsers([...users, updatedUser]);
        }
      }

      setShowNewUserForm(false);
      // Refresh license usage after creating a user
      fetchLicenseUsage();
      // Reset newUser state with the default role
      setNewUser({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        role: roles.length > 0 ? roles[0].role_id : '',
        clientId: '',
        reportsTo: ''
      });
      // Clear field errors
      setFieldErrors({
        first_name: [],
        last_name: [],
        email: []
      });
    } catch (error: unknown) {
      const message = normalizeCreateUserError(error);
      handleError(error, message);
      setError(message);
    }
  };

  const handleDeleteSuccess = () => {
    fetchUsers();
    fetchLicenseUsage();
  };

  const handlePortalTypeChange = (type: 'msp' | 'client') => {
    setPortalType(type);
    setShowNewUserForm(false);
    setSelectedClientId(null);
    setNewUser({
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      role: '',
      clientId: '',
      reportsTo: ''
    });
    setError(null);
    setFieldErrors({
      first_name: [],
      last_name: [],
      email: []
    });
  };

  const statusOptions = [
    { value: 'all', label: t('users.filter.all') },
    { value: 'active', label: t('users.filter.active') },
    { value: 'inactive', label: t('users.filter.inactive') }
  ];

  const viewOptions: ViewSwitcherOption<'msp' | 'client'>[] = [
    { value: 'msp', label: t('users.viewSwitcher.msp') },
    { value: 'client', label: t('users.viewSwitcher.clientPortal') }
  ];


  const getDisplayName = (user: IUser) => {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return fullName || user.email;
  };

  const renderNewUserForm = () => (
    <div className="mb-4 p-4 border rounded-md">
      <h3 className="text-lg font-semibold mb-2">
        {portalType === 'msp' ? t('users.form.title.msp') : t('users.form.title.client')}
      </h3>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left column: manual details */}
          <div className="space-y-2">
            <div>
              <Label htmlFor="first-name">{t('users.form.fields.firstName')} <span className="text-destructive">*</span></Label>
              <Input
                id="first-name"
                value={newUser.firstName}
                onChange={(e) => {
                  handleFieldChange('first_name', e.target.value);
                }}
                onBlur={() => {
                  validateField('first_name', newUser.firstName);
                }}
                className={fieldErrors.first_name.length > 0 ? 'border-destructive' : ''}
              />
              {fieldErrors.first_name.length > 0 && (
                <div className="text-sm text-destructive mt-1">
                  {fieldErrors.first_name.map((error, idx) => (
                    <p key={idx}>{error}</p>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="last-name">{t('users.form.fields.lastName')} <span className="text-destructive">*</span></Label>
              <Input
                id="last-name"
                value={newUser.lastName}
                onChange={(e) => {
                  handleFieldChange('last_name', e.target.value);
                }}
                onBlur={() => {
                  validateField('last_name', newUser.lastName);
                }}
                className={fieldErrors.last_name.length > 0 ? 'border-destructive' : ''}
              />
              {fieldErrors.last_name.length > 0 && (
                <div className="text-sm text-destructive mt-1">
                  {fieldErrors.last_name.map((error, idx) => (
                    <p key={idx}>{error}</p>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="email">{t('users.form.fields.email')} <span className="text-destructive">*</span></Label>
              <Input
                id="email"
                type="email"
                value={newUser.email}
                onChange={(e) => {
                  handleFieldChange('email', e.target.value);
                }}
                onBlur={() => {
                  validateField('email', newUser.email);
                }}
                className={fieldErrors.email.length > 0 ? 'border-destructive' : ''}
              />
              {fieldErrors.email.length > 0 && (
                <div className="text-sm text-destructive mt-1">
                  {fieldErrors.email.map((error, idx) => (
                    <p key={idx}>{error}</p>
                  ))}
                </div>
              )}
            </div>
            {portalType === 'client' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('users.form.fields.client')}
                  <span className="text-sm text-gray-500"> {t('users.form.fields.clientOptional')}</span>
                </label>
                <ClientPicker
                  id="new-user-client-picker"
                  clients={clients}
                  selectedClientId={newUser.clientId || null}
                  onSelect={(clientId) => setNewUser({ ...newUser, clientId: clientId || '' })}
                  filterState={clientFilterState}
                  onFilterStateChange={(state) => setClientFilterState(state)}
                  clientTypeFilter={clientClientTypeFilter}
                  onClientTypeFilterChange={(filter) => setClientClientTypeFilter(filter)}
                  placeholder={t('users.form.fields.selectClient')}
                  fitContent={false}
                />
              </div>
            )}
            <div>
              <CustomSelect
                label={t('users.form.fields.primaryRole')}
                value={newUser.role}
                onValueChange={(value) => setNewUser({ ...newUser, role: value })}
                options={roles.map((role): SelectOption => ({
                  value: role.role_id,
                  label: role.role_name
                }))}
                placeholder={t('users.form.fields.selectRole')}
              />
            </div>
            {isTeamsV2Enabled && portalType === 'msp' && (
              <div>
                <Label>{t('users.form.fields.reportsTo')} <span className="text-sm text-muted-foreground font-normal">{t('users.form.fields.reportsToOptional')}</span></Label>
                <UserPicker
                  value={newUser.reportsTo}
                  onValueChange={(value) => setNewUser({ ...newUser, reportsTo: value || '' })}
                  users={users.filter(u => !u.is_inactive)}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  labelStyle="none"
                  buttonWidth="full"
                  size="sm"
                  placeholder={t('users.form.fields.selectManager')}
                />
              </div>
            )}
          </div>

          {/* Right column: existing contact OR set password */}
          <div className="space-y-4">
            {portalType === 'client' && (
              <div>
                <Label className="block text-sm font-medium text-gray-700 mb-1">{t('users.form.fields.existingContact')}
                  <span className="text-sm text-gray-500"> {t('users.form.fields.existingContactOptional')}</span> </Label>
                <ContactPicker
                  id="new-user-contact-picker"
                  contacts={contacts}
                  value={selectedContactId || ''}
                  onValueChange={(cid) => {
                    setSelectedContactId(cid || null);
                    setContactValidationError(null);
                    if (cid) {
                      const c = contacts.find((x) => x.contact_name_id === cid);
                      if (c) {
                        const parts = (c.full_name || '').trim().split(' ');
                        setNewUser({
                          ...newUser,
                          firstName: parts[0] || c.full_name || '',
                          lastName: parts.slice(1).join(' '),
                          email: c.email || '',
                          clientId: c.client_id || ''
                        });

                        // Check if contact has email when sending invitation
                        if (!newUser.password && (!c.email || c.email.trim() === '')) {
                          setContactValidationError(t('users.messages.error.contactMissingEmail', { name: c.full_name }));
                        }
                      }
                    } else {
                      setContactValidationError(null);
                    }
                  }}
                  clientId={newUser.clientId || undefined}
                  label={newUser.password ? t('users.form.fields.selectExistingContact') : t('users.form.fields.selectExistingContactRequired')}
                  placeholder={newUser.password ? t('users.form.fields.selectExistingContact') : t('users.form.fields.selectContactToInvite')}
                  onAddNew={() => setIsQuickAddContactOpen(true)}
                />
                <QuickAddContact
                  isOpen={isQuickAddContactOpen}
                  onClose={() => setIsQuickAddContactOpen(false)}
                  onContactAdded={(newContact) => {
                    setContacts((prevContacts) => {
                      const existingIndex = prevContacts.findIndex((contact) => contact.contact_name_id === newContact.contact_name_id);
                      if (existingIndex >= 0) {
                        const nextContacts = [...prevContacts];
                        nextContacts[existingIndex] = newContact;
                        return nextContacts;
                      }
                      return [...prevContacts, newContact];
                    });
                    setSelectedContactId(newContact.contact_name_id);
                    const parts = (newContact.full_name || '').trim().split(' ');
                    setNewUser((prevUser) => ({
                      ...prevUser,
                      firstName: parts[0] || newContact.full_name || '',
                      lastName: parts.slice(1).join(' '),
                      email: newContact.email || '',
                      clientId: newContact.client_id || prevUser.clientId,
                    }));
                    setContactValidationError(null);
                    setIsQuickAddContactOpen(false);
                  }}
                  clients={clients}
                  selectedClientId={newUser.clientId || undefined}
                />
              </div>
            )}
            <div>
              <Label htmlFor="password">
                {t('users.form.fields.password')} {portalType === 'msp' && <span className="text-destructive">*</span>} {portalType === 'client' && <span className="text-sm text-gray-500">{t('users.form.fields.passwordOptional')}</span>}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={newUser.password}
                  onChange={(e) => {
                    setNewUser({ ...newUser, password: e.target.value });
                    // Clear validation error when password is entered
                    if (e.target.value && contactValidationError) {
                      setContactValidationError(null);
                    }
                  }}
                  className="pr-10"
                  placeholder={portalType === 'client' ? t('users.form.fields.passwordPlaceholder.client') : t('users.form.fields.passwordPlaceholder.msp')}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  id={showPassword ? 'hide-password-button' : 'show-password-button'}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
              {portalType === 'client' && (
                <Alert variant={newUser.password ? 'info' : 'warning'} className="mt-2">
                  <AlertDescription>
                    {newUser.password
                      ? t('users.form.passwordAlert.withPassword')
                      : t('users.form.passwordAlert.withoutPassword')}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            id={`submit-new-${portalType}-user-btn`}
            variant={
              portalType === 'msp' && licenseUsage?.limit !== null && licenseUsage?.remaining === 0
                ? 'secondary'
                : 'default'
            }
            onClick={
              portalType === 'msp' && licenseUsage?.limit !== null && licenseUsage?.remaining === 0
                ? () => window.location.href = '/msp/licenses/purchase'
                : handleCreateUser
            }
            disabled={portalType === 'client' && !newUser.password && !!contactValidationError}
          >
            {portalType === 'msp' && licenseUsage?.limit !== null && licenseUsage?.remaining === 0
              ? t('users.license.addLicense')
              : portalType === 'msp'
                ? t('users.actions.createUser')
                : newUser.password
                  ? t('users.actions.createUser')
                  : t('users.actions.sendInvitation')}
          </Button>
          <Button
            id={`cancel-new-${portalType}-user-btn`}
            variant="outline"
            onClick={() => {
              setShowNewUserForm(false);
              setNewUser({
                firstName: '',
                lastName: '',
                email: '',
                password: '',
                role: roles.length > 0 ? roles[0].role_id : '',
                clientId: '',
                reportsTo: ''
              });
              setError(null);
              setFieldErrors({
                first_name: [],
                last_name: [],
                email: []
              });
            }}
          >
            {t('users.actions.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );

  const renderCreateUserActions = () => (
    <div className="flex items-center gap-3">
      {portalType === 'client' && (
        <Button
          id="copy-client-portal-link-button"
          variant="outline"
          onClick={handleCopyPortalLink}
          disabled={isCopyingPortalLink}
        >
          {isCopyingPortalLink ? t('users.actions.copying') : t('users.actions.copyPortalLink')}
        </Button>
      )}
      {!showNewUserForm && (
        <div className="flex flex-col items-end gap-1">
          <Button
            id={`create-new-${portalType}-user-btn`}
            onClick={() => setShowNewUserForm(true)}
            disabled={portalType === 'msp' && soloMspUserLimitReached}
          >
            {portalType === 'msp' ? t('users.actions.createNewUser') : t('users.actions.createNewClientUser')}
          </Button>
          {portalType === 'msp' && soloMspUserLimitReached && (
            <span className="text-sm text-muted-foreground">
              {soloMspLimitMessage}
            </span>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>{t('users.title')}</CardTitle>
            <CardDescription>
              {portalType === 'msp' ? t('users.description.msp') : t('users.description.client')}
            </CardDescription>
          </div>
          <ViewSwitcher
            currentView={portalType}
            onChange={handlePortalTypeChange}
            options={viewOptions}
          />
        </div>
      </CardHeader>
      <CardContent>
        {/* License Usage Banner for MSP Portal */}
        {portalType === 'msp' && licenseUsage && (
          <Alert
            id="msp-licence-usage-banner"
            variant="info"
            className="mb-4"
          >
            <AlertDescription className="flex items-center justify-between">
              <span>
                {t('users.license.usage', {
                  used: licenseUsage.used,
                  limit: licenseUsage.limit !== null
                    ? t('users.license.ofLimit', { limit: licenseUsage.limit })
                    : t('users.license.noLimit')
                })}
              </span>
              {licenseUsage.limit !== null && licenseUsage.remaining === 0 && (
                <span>
                  {t('users.license.addLicensePrompt')}
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}
        {isTeamsV2Enabled && portalType === 'msp' ? (
          <>
            <div className="flex justify-between mb-4">
              <div className="flex gap-6 items-center">
                <div className="relative p-0.5">
                  <Input
                    type="text"
                    placeholder={t('users.search')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
                  />
                  <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                </div>
                <div>
                  <CustomSelect
                    value={filterStatus}
                    onValueChange={(value) => setFilterStatus(value as 'all' | 'active' | 'inactive')}
                    options={statusOptions}
                    placeholder={t('users.filter.selectStatus')}
                  />
                </div>
              </div>
              {renderCreateUserActions()}
            </div>
            {showNewUserForm && renderNewUserForm()}
            <Tabs value={userView} onValueChange={(v) => setUserView(v as 'list' | 'org')}>
              <TabsList>
                <TabsTrigger value="list">{t('users.tabs.list')}</TabsTrigger>
                <TabsTrigger value="org">{t('users.tabs.structure')}</TabsTrigger>
              </TabsList>
              <TabsContent value="list">
                <p className="text-sm text-muted-foreground mt-3 mb-4">{t('users.tabs.listDescription')}</p>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <LoadingIndicator
                      layout="stacked"
                      text={t('users.loading')}
                      spinnerProps={{ size: 'md' }}
                    />
                  </div>
                ) : (
                  <UserList
                    users={filteredUsers}
                    onUpdate={fetchUsers}
                    onDeleteSuccess={handleDeleteSuccess}
                    selectedClientId={null}
                  />
                )}
              </TabsContent>
              <TabsContent value="org">
                <p className="text-sm text-muted-foreground mt-3 mb-4">{t('users.tabs.structureDescription')}</p>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <LoadingIndicator
                      layout="stacked"
                      text={t('users.loading')}
                      spinnerProps={{ size: 'md' }}
                    />
                  </div>
                ) : (
                  <OrgChart
                    users={users.filter(u =>
                      filterStatus === 'all' ||
                      (filterStatus === 'active' && !u.is_inactive) ||
                      (filterStatus === 'inactive' && u.is_inactive)
                    )}
                    onUserUpdated={fetchUsers}
                    searchTerm={searchTerm}
                  />
                )}
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <>
            <div className="flex justify-between mb-4">
              <div className="flex gap-6 items-center">
                <div className="relative p-0.5">
                  <Input
                    type="text"
                    placeholder={t('users.search')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
                  />
                  <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                </div>
                <div>
                  <CustomSelect
                    value={filterStatus}
                    onValueChange={(value) => setFilterStatus(value as 'all' | 'active' | 'inactive')}
                    options={statusOptions}
                    placeholder={t('users.filter.selectStatus')}
                  />
                </div>
                {portalType === 'client' && (
                  <div>
                    <ClientPicker
                      id="user-management-client-filter"
                      clients={clients}
                      selectedClientId={selectedClientId}
                      onSelect={(clientId) => setSelectedClientId(clientId)}
                      filterState={clientFilterState}
                      onFilterStateChange={(state) => setClientFilterState(state)}
                      clientTypeFilter={clientClientTypeFilter}
                      onClientTypeFilterChange={(filter) => setClientClientTypeFilter(filter)}
                      placeholder={t('users.form.fields.selectClient')}
                      fitContent={true}
                    />
                  </div>
                )}
              </div>
              {renderCreateUserActions()}
            </div>
            {showNewUserForm && renderNewUserForm()}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingIndicator
                  layout="stacked"
                  text={t('users.loading')}
                  spinnerProps={{ size: 'md' }}
                />
              </div>
            ) : (
              <UserList
                users={filteredUsers}
                onUpdate={fetchUsers}
                onDeleteSuccess={handleDeleteSuccess}
                selectedClientId={portalType === 'client' ? selectedClientId : null}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default UserManagement;
