# Piano lavoro split `app.component.ts`

## Obiettivo
Ridurre `ozon-app-web/src/app/app.component.ts` a orchestratore. Spostare logica in manager separati, senza cambiare contratto API né comportamento UI.

## Target
- `src/app/app-theme-manager.ts`
- `src/app/app-manager.ts`
- `src/app/app-action-manager.ts`
- `src/app/app-table-manager.ts`
- `src/app/app-formio-builder.ts`
- `src/app/app-formio-renderer.ts`
- `ozon-app-web/src/app/app.component.ts` resta solo orchestratore, input/output UI, state glue.

## Divisione responsabilità

### `appThemeManager`
- Read/write tema da storage/query.
- Bootstrap theme sync su `data-theme` / `data-bs-theme`.
- Toggle light/dark.
- Sposta da `app.component.ts`:
  - `initializeTheme()`
  - `setTheme()`
  - `readThemeFromQuery()`
  - `readThemeFromStorage()`
  - `normalizeTheme()`
  - `onThemeSwitchChanged()`
  - `currentThemeLabel`
  - `isDarkTheme`

### `appManager`
- Load layout.
- Load menu e dashboard card.
- Top menu, drilldown, card normalization.
- User display state legato a layout.
- Sposta da `app.component.ts`:
  - `loadActionLayout()`
  - `loadActionMenu()`
  - `loadActionDashboard()`
  - `applyLayoutResponse()`
  - `applyMenuResponse()`
  - `applyDashboardResponse()`
  - `normalizeActionMenuCards()`
  - `normalizeActionCards()`
  - `toMenuCard()`
  - `toDynamicMenuCards()`
  - `toFlatMenuCard()`
  - `groupMenuCardsByMenuGroup()`
  - `syncActiveDashboardGroup()`
  - `menuDrilldownGroups()`
  - `openTopMenu()`
  - `closeTopMenu()`
  - `dashboardTitle`
  - `topMenuCards`
  - `nonAdminDashboardCards`
  - `selectedTopMenuCard`
  - `showTopMenu`
  - `showHomeButton`
  - `showLoginButton`
  - `showLogoutButton`

### `appActionManager`
- `runActionRoute`.
- `applyActionResponse`.
- `runMenuAction`.
- `saveCurrentRecord`, `copy`, `delete`, `next_action`, redirect.
- Action buttons derivati da metadata backend.
- Sposta da `app.component.ts`:
  - `handleLocationRoute()`
  - `navigateToPath()`
  - `runActionRoute()`
  - `runNextActionRoute()`
  - `runWindowPath()`
  - `runWindowAction()`
  - `runMenuAction()`
  - `runPostActionButton()`
  - `applyInvokedActionResponse()`
  - `applyActionResponse()`
  - `applyActionListResponse()`
  - `applyActionFormResponse()`
  - `resolveFormResponseActionButtons()`
  - `resolveFormSubmitActionPathFromResponse()`
  - `resolveFormSubmitNextActionPathFromResponse()`
  - `resolveActionSequenceButtons()`
  - `resolveActionSequenceMetadata()`
  - `buildAbandonActionButton()`
  - `normalizeFormResponseButtonsCandidate()`
  - `buildFormSubmitActionButton()`
  - `saveCurrentRecord()`
  - `copyCurrentRecordName()`
  - `removeCurrentRecordFromView()`
  - `canRunMenuAction()`
  - `isPostActionButton()`
  - `getButtonActionPath()`
  - `menuActionHref()`
  - `resolveButtonIconClass()`
  - `resolveBootstrapItaliaIconSrc()`
  - `resolveBootstrapItaliaIconHref()`
  - `extractActionResponse()`
  - `extractNextActionRedirect*()` family
  - `collectNextActionRedirectCandidates()`
  - `parseActionRoute()`
  - `resolveCurrentActionName()`
  - `buildFallbackFormActionButtons()`
  - `mergeFormResponseButtonsWithFallback()`
  - `ensureCopyFormActionButton()`

### `appTableManager`
- `loadRecords`.
- Table columns normalization.
- Query/filter/pagination.
- Table row actions and server-side row copy/remove.
- Cell renderer cache for table preview.
- Sposta da `app.component.ts`:
  - `loadRecords()`
  - `onTableLazyLoad()`
  - `onTableRowClick()`
  - `onTableRowDblClick()`
  - `onTableSelectionChange()`
  - `onCopyRow()`
  - `onRemoveRow()`
  - `executeTableRowServerAction()`
  - `resolveTableRowActionPath()`
  - `shouldAppendRowRecNameToActionPath()`
  - `appendRecNameToActionPath()`
  - `applyTableColumnsFromHeader()`
  - `buildTableColumnsFromHeader()`
  - `normalizeTableColumnsPayload()`
  - `appendRecordRow()`
  - `resetSelectionAndTable()`
  - `refreshTableRows()`
  - `reconcileSelectionWithVisibleRows()`
  - `syncPaginationStateFromStream()`
  - `rowMatchesFilter()`
  - `resolveFieldValue()`
  - `resolveRowValueContexts()`
  - `resolvePath()`
  - `displayCell()`
  - `trackRowBy()`
  - `trackColumnBy()`
  - `tableColumnCount`
  - `tableActionColumnCount`
  - `tableExtraColumnCount`
  - `showTableRowCopyAction`
  - `showTableRowRemoveAction`
  - `refreshTableCellRenderers()`
  - `configureTableCellRenderers()`
  - `buildTableRenderSubmission()`
  - `rebuildTableCellRenderers()`
  - `collectTableCellRenderers()`
  - `createTableCellRenderer()`
  - `createDateTableCellRenderer()`
  - `createOptionsTableCellRenderer()`
  - `createSelectBoxesTableCellRenderer()`
  - `extractSchemaOptions()`
  - `resolveTableCellRenderer()`
  - `findTableCellRenderer()`
  - `expandFieldCandidates()`
  - `parseNonNegativeInt()`

### `AppFormioBuilder`
- Builder enable/disable.
- Builder schema draft.
- `refreshFormBuilderConfigForCurrentForm`.
- `resolveBuilderComponentSchema`.
- `syncBuilderMode`.
- `syncBuilderSchemaFromLiveInstance`.
- `applyBuilderDraftToSubmission`.
- Sposta da `app.component.ts`:
  - `showFormBuilder`
  - `canEditCurrentForm`
  - `canOpenFormEditor`
  - `canPreviewFormEditor`
  - `formEditorActionButtons`
  - `formEditorSaveLabel`
  - `builderSchemaForm`
  - `builderSwitchLabel`
  - `openFormEditorInline()`
  - `enableFormBuilderMode()`
  - `disableFormBuilderMode()`
  - `setFormEditorActiveTab()`
  - `updateFormEditorField()`
  - `updateFormEditorProperty()`
  - `previewFormEditor()`
  - `refreshFormBuilderConfigForCurrentForm()`
  - `applyFormBuilderConfig()`
  - `resolveBuilderParentModel()`
  - `loadParentModelBuilderComponents()`
  - `buildParentModelBuilderComponents()`
  - `builderIconForComponentType()`
  - `syncBuilderMode()`
  - `syncDirectRecordBuilderMode()`
  - `resolveBuilderComponentSchema()`
  - `isBuilderEligibleResponse()`
  - `isDesignContextResponse()`
  - `extractBuilderSchema()`
  - `syncBuilderSchemaFromLiveInstance()`
  - `applyBuilderDraftToSubmission()`

### `AppFormioRenderer`
- Form schema extraction.
- Render payload normalization for Form.io client.
- Remote select hydration.
- Submission seed/merge.
- WYSIWYG/editor normalization.
- Form viewer state and action buttons for render mode.
- Sposta da `app.component.ts`:
  - `loadSchema()`
  - `openSelectedRecord()`
  - `openRecordFromListSelection()`
  - `openNewRecord()`
  - `extractSchema()`
  - `extractFormSchema()`
  - `extractActionFormSchema()`
  - `extractSubmission()`
  - `extractRecord()`
  - `collectResponseNodes()`
  - `isEnvelopeNode()`
  - `readEnvelopeFailureMessage()`
  - `normalizeFormSubmissionData()`
  - `scoreFormSubmissionData()`
  - `resolveBestActionFormData()`
  - `buildSubmissionDataValueAlias()`
  - `hydrateRemoteSelectSchema()`
  - `findSelectComponents()`
  - `extractRemoteSelectPayload()`
  - `fetchRemoteSelectOptions()`
  - `normalizeRemoteSelectResponse()`
  - `normalizeRemoteHeaders()`
  - `normalizeRemoteDomain()`
  - `normalizeFormTableComponents()`
  - `normalizeFormWysiwygComponents()`
  - `seedSubmissionDefaultsIntoSchema()`
  - `applyRemoteSelectValues()`
  - `mergeSelectValues()`
  - `extractSubmissionSelectOptions()`
  - `toSelectValueOption()`
  - `option*` helpers
  - `readComponentProperties()`
  - `readPropertyValue()`

## Ordine lavoro
1. Creare nuovi file service/helper.
2. Estrarre `appThemeManager`.
3. Estrarre `appManager`.
4. Estrarre `appTableManager`.
5. Estrarre `AppFormioRenderer`.
6. Estrarre `AppFormioBuilder`.
7. Estrarre `appActionManager`.
8. Lasciare in `app.component.ts` solo wiring, state, input/output.
9. Riallineare test per file nuovo.

## Regole
- Nessun workaround.
- Nessuna monkey patch.
- Contratto backend invariato.
- Form payload: `content.mode === 'form'` + `content.schema`.
- Select locali restano `dataSrc: 'values'`.
- `Persona` resta `User` select dove richiesto.
- Prima split, no functional change.

## Test
- Manteneri `app.component.spec.ts` verde durante refactor.
- Aggiungere test per ogni manager estratto.
- Verifica finale su route action, form render, builder, table, theme.
- `npm test -- --include src/app/app.component.spec.ts`

## Rischi
- Stato condiviso troppo grosso in `app.component.ts`.
- Doppia inizializzazione Form.io durante split.
- Test legacy con fixture vecchie da riallineare al contratto nuovo.
- Cicli dipendenza tra action/render/builder se separazione troppo aggressiva.
