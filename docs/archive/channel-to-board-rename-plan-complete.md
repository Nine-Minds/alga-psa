# Channel to Board Rename - Complete Plan

## Phase 1: Frontend Text Changes (COMPLETED ✓)

### What Was Changed:
1. **ChannelsSettings.tsx**
   - All UI text updated from "Channel" to "Board"
   - Error messages and success messages updated
   
2. **ChannelPicker.tsx**
   - Placeholders and labels updated
   - Filter options text updated
   
3. **TicketingConfigStep.tsx**
   - Section headings and button text updated
   - Form labels and placeholders updated
   - Import dialog text updated
   
4. **QuickAddTicket.tsx**
   - Placeholder text updated
   
5. **CategoriesSettings.tsx**
   - Column headers and filter options updated
   - Form labels and error messages updated
   
6. **TicketingSettings.tsx**
   - Tab labels and placeholders updated
   
7. **channelActions.ts**
   - Error messages updated

### What Was NOT Changed:
- Variable names
- Function names
- File names
- Database fields
- API endpoints

## Phase 2: Database Migration (FUTURE)

### 2.1 Migration File
Create migration `rename_channels_to_boards.cjs`:

#### Tables to Rename:
- `channels` → `boards`
- `standard_channels` → `standard_boards`

#### Columns to Rename:
- In `boards` table:
  - `channel_id` → `board_id`
  - `channel_name` → `board_name`
- In `standard_boards` table:
  - `channel_name` → `board_name`
- In `categories` table:
  - `channel_id` → `board_id`
- In `tickets` table:
  - `channel_id` → `board_id`
- In `tag_definitions` table:
  - `channel_id` → `board_id`

#### Constraints to Update:
- Primary keys
- Foreign key constraints
- Check constraints
- RLS policies

## Phase 3: Backend Code Changes (FUTURE)

### 3.1 Interfaces and Types

#### Files to Rename:
- `/server/src/interfaces/channel.interface.ts` → `board.interface.ts`

#### Interface Changes:
```typescript
// Old
export interface IChannel extends TenantEntity {
  channel_id?: string;
  channel_name?: string;
  // ...
}

// New
export interface IBoard extends TenantEntity {
  board_id?: string;
  board_name?: string;
  // ...
}
```

#### Update Imports:
- Update exports in `/server/src/interfaces/index.ts`
- Update all files importing `IChannel` to import `IBoard`

### 3.2 Models

#### Files to Rename:
- `/server/src/lib/models/channel.ts` → `board.ts`

#### Model Changes:
- Rename `Channel` object to `Board`
- Update all table references from 'channels' to 'boards'
- Update all column references

### 3.3 Actions

#### Files to Rename:
- `/server/src/lib/actions/channel-actions/` → `board-actions/`
- `channelActions.ts` → `boardActions.ts`

#### Function Renames:
- `findChannelById` → `findBoardById`
- `findChannelByName` → `findBoardByName`
- `getAllChannels` → `getAllBoards`
- `createChannel` → `createBoard`
- `updateChannel` → `updateBoard`
- `deleteChannel` → `deleteBoard`

#### Type Renames:
- `FindChannelByNameOutput` → `FindBoardByNameOutput`

### 3.4 API Routes

#### Route Path Changes:
- `/api/v1/categories/ticket/tree/[channelId]` → `/api/v1/categories/ticket/tree/[boardId]`

#### Files to Update:
- Rename folder `[channelId]` to `[boardId]`
- Update parameter names in route handlers

### 3.5 Services
Update all references in:
- `TeamService.ts`
- `TicketService.ts`
- `CategoryService.ts`
- `TagService.ts`

### 3.6 Validation Schemas
Update field names in:
- `teamSchemas.ts`
- `ticket.ts`
- `categorySchemas.ts`
- `tagSchemas.ts`
- `webhookSchemas.ts`

## Phase 4: Frontend Full Integration (FUTURE)

### 4.1 Component File Renames
- `ChannelsSettings.tsx` → `BoardsSettings.tsx`
- `ChannelPicker.tsx` → `BoardPicker.tsx`

### 4.2 Update All Props and State Variables
```typescript
// Examples of changes needed:
channelId → boardId
channelName → boardName
selectedChannel → selectedBoard
channels → boards
channelData → boardData
channelFilter → boardFilter
onChannelSelect → onBoardSelect
```

### 4.3 Update Component Imports
```typescript
// Old
import { IChannel } from '@/interfaces/channel.interface';
import { getAllChannels } from '@/actions/channel-actions/channelActions';
import ChannelPicker from '@/components/settings/general/ChannelPicker';

// New
import { IBoard } from '@/interfaces/board.interface';
import { getAllBoards } from '@/actions/board-actions/boardActions';
import BoardPicker from '@/components/settings/general/BoardPicker';
```

### 4.4 Update API Calls
- Update all action imports
- Update function calls
- Update response handling

## Phase 5: Test Updates (FUTURE)

### 5.1 Update Test Files
- E2E tests in `/server/src/test/e2e/`
- Unit tests in `/server/src/test/unit/`
- Update test data and fixtures
- Update test descriptions and assertions

### 5.2 Update Test Data
- Change mock data from channel to board
- Update test database seeds

## Phase 6: Additional Areas (FUTURE)

### 6.1 Workflow and Email Processing
- Update `emailService.ts`
- Update `system-email-processing-workflow.ts`

### 6.2 Seed Data and Migrations
- Update seed data scripts
- Update reference data

### 6.3 Documentation
- Update API documentation
- Update user guides
- Update code comments

## Phase 7: Deployment Strategy (FUTURE)

### 7.1 Pre-deployment
1. Full backup of production database
2. Test migration on staging environment
3. Run full regression test suite
4. Prepare rollback plan

### 7.2 Deployment Steps
1. Deploy backend changes with backwards compatibility
2. Run database migration
3. Deploy frontend changes
4. Verify all functionality
5. Remove backwards compatibility layer (if any)

### 7.3 Post-deployment
1. Monitor for errors
2. Verify data integrity
3. Update external documentation
4. Communicate changes to users

## Estimated Timeline for Full Overhaul

1. **Database Migration Development**: 4-6 hours
2. **Backend Code Changes**: 8-10 hours
3. **Frontend Full Integration**: 6-8 hours
4. **Testing and Verification**: 6-8 hours
5. **Documentation Updates**: 2-3 hours
6. **Deployment and Monitoring**: 2-3 hours

**Total Estimated Time**: 28-38 hours

## Risk Mitigation

### High Risk Areas:
1. **Database Migration** - Foreign key constraints could fail
   - Mitigation: Test thoroughly on staging, have rollback ready
   
2. **API Breaking Changes** - External integrations might break
   - Mitigation: Maintain backwards compatibility layer temporarily
   
3. **Missed References** - Some channel references might be missed
   - Mitigation: Comprehensive search and testing

### Medium Risk Areas:
1. **Performance Impact** - Migration might lock tables
   - Mitigation: Run during low-traffic period
   
2. **User Confusion** - Sudden terminology change
   - Mitigation: Communicate changes in advance

## Notes for Implementation

1. **Backwards Compatibility**: Consider maintaining both `channel_id` and `board_id` temporarily
2. **API Versioning**: May need to create v2 endpoints
3. **Feature Flags**: Consider using feature flags for gradual rollout
4. **Monitoring**: Set up alerts for any channel-related errors post-deployment