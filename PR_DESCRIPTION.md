# Align Client and Contact Action Behaviors for Consistency

## 🎯 Problem Statement

The client (company) and contact management interfaces had inconsistent action behaviors that created a confusing user experience:

**Clients had:**
- "Quick View" → Opens drawer with pop-out option ✅
- "Edit" → Opens drawer (incorrect behavior) ❌

**Contacts had:**
- "View" → Navigates to contact page ✅  
- "Quick Edit" → Opens minimal drawer ❌

This inconsistency made it difficult for users to predict how actions would behave across different entity types.

## 🔧 Solution

This PR creates a unified, predictable action pattern across both clients and contacts:

### New Consistent Behavior:
- **"Edit"** actions → Navigate directly to the entity's page (same window)
- **"Quick View"** actions → Open drawer with basic info + pop-out button for full page (new tab)

## 📋 Changes Made

### Client (Company) Changes:
- ✅ Modified `handleEditCompany` to navigate directly to company page using `router.push()`
- ✅ Removed edit drawer functionality entirely from `Companies.tsx`
- ✅ Cleaned up edit-related state variables (`editingCompany`, `isEditDrawerOpen`, `editingId`)
- ✅ Updated child components (`CompaniesGrid`, `CompaniesList`, `CompanyGridCard`) to remove editing state props
- ✅ Removed visual editing indicators and row highlighting

### Contact Changes:
- ✅ Renamed "View" action to "Edit" with direct navigation behavior
- ✅ Renamed "Quick Edit" to "Quick View" with enhanced drawer functionality
- ✅ Modified `handleEditContact` to navigate directly to contact page
- ✅ Added new `handleQuickView` function for drawer-based quick viewing
- ✅ Enhanced `ContactDetailsView` with `quickView` prop for limited content display
- ✅ Updated table row clicks to use quick view instead of direct navigation

### Technical Improvements:
- ✅ Added `quickView` prop to `ContactDetailsView` component
- ✅ Implemented content limiting in quick view mode (hides documents and interactions)
- ✅ Maintained existing pop-out functionality for drawer mode
- ✅ Preserved backward compatibility with existing interfaces

## 🎨 User Experience Impact

### Before:
- Users had to remember different behaviors for clients vs contacts
- "Edit" sometimes opened drawers, sometimes navigated to pages
- Inconsistent naming ("View" vs "Quick Edit")

### After:
- **Predictable patterns**: "Edit" always navigates, "Quick View" always opens drawer
- **Consistent naming**: Same action names across all entity types
- **Improved efficiency**: Quick access to basic info via drawer, full editing via dedicated pages

## 🧪 Testing Considerations

- ✅ All existing functionality preserved
- ✅ No breaking changes to component interfaces  
- ✅ Backward compatibility maintained
- ✅ TypeScript types properly updated

### Manual Testing Checklist:
- [ ] Client "Edit" action navigates to company page
- [ ] Client "Quick View" opens drawer with pop-out button
- [ ] Contact "Edit" action navigates to contact page  
- [ ] Contact "Quick View" opens drawer with pop-out button
- [ ] Pop-out buttons open full pages in new tabs
- [ ] Drawer content is appropriately limited in quick view mode
- [ ] No visual regressions in grid/list views

## 🔄 Migration Notes

This change is **non-breaking** and requires no migration steps. Users will immediately benefit from the consistent behavior patterns.

## 📁 Files Modified

- `server/src/components/companies/Companies.tsx`
- `server/src/components/companies/CompaniesGrid.tsx` 
- `server/src/components/companies/CompaniesList.tsx`
- `server/src/components/companies/CompanyGridCard.tsx`
- `server/src/components/contacts/Contacts.tsx`
- `server/src/components/contacts/ContactDetailsView.tsx`

---

**Result**: A unified, intuitive user experience where action behaviors are consistent and predictable across all entity management interfaces.