# Trends Dashboard Design & Implementation Specification

## 1. Overview
The **Trends Dashboard** is a newly proposed analytical view designed to provide longitudinal insights into various key performance indicators (KPIs) over time. It answers the question: *"How are our KPIs performing week-over-week across different dimensions like Stores, Cities, Product Categories, and Purchase Barriers?"*

## 2. Navigation & Access
*   **Entry Point**: A prominent button on the main `Analytics Dashboard`. 
*   **Placement**: Located in the top-right header area, adjacent to the "Selected Calls" metrics box (as per the red-boxed provided location).
*   **Button Design**: A premium, distinguished button (e.g., "📈 View Trends" with a subtle glow or gradient) to signify advanced longitudinal analytics.

## 3. UI/UX Design Principles
To achieve the requested "high quality, premium UI", the dashboard will feature:
*   **Glassmorphic Header**: Sticky header or toolbars with blur effects for a modern look.
*   **Visual Hierarchy**: Clear separation between the global filters and the dimensional tables.
*   **Sparklines / Micro-charts**: Incorporating small line charts ("sparklines") within the table rows or as standalone visualizers to fulfill the "line chart like functionality" aesthetic natively in the data grid.
*   **Smooth Transitions**: Animated sorting, filtering, and tab switching.
*   **Color-coded KPIs**: Consistent color coding for different KPIs (e.g., Revenue in emerald, Conversions in blue, NPS in amber) to make multi-KPI reading intuitive.

## 4. Core Functionality & Layout

### 4.1 Global Control Panel (Filters)
*   **Date Range Selector (Week Granularity)**: 
    *   Allows selection of Date Ranges based strictly on **Week Start Dates** (Monday to Sunday).
    *   *Constraint*: Weeks start categorizing from **2nd March 2025**.
    *   *Default*: Maximum available date range in the dataset.
*   **KPI Multiselect Dropdown**: 
    *   Allows users to select which KPIs to view across the trends.
    *   *Default*: `# of Leads`, `Revenue per lead`, `Conversion %`, `ARPU`, `Avg NPS (Brand)`, `Avg NPS (Agent)`, `Video Demo %`, `WA Connection %`.
    *   *Other options*: `% Bad Calls`, `Store Invitation %`, `Probing - Why %`, `ProActive %`.
*   **Entity Multiselect (Row Selectors)**: 
    *   Allows filtering specific Stores, Cities, Categories, or Barriers depending on the active view.

### 4.2 The "Line Chart / Table" Hybrid Grid
The core data visualization will be repeated four times (or placed into 4 distinct tabs/sections) in this specific order:
1.  **Store**
2.  **City**
3.  **Product Category**
4.  **Purchase Barrier**

#### Grid Structure:
*   **Columns**: Week strings (e.g., "Week of 2nd Mar '25", "Week of 9th Mar '25", progressing Left to Right).
*   **Rows**: The specific entity (e.g., "Store A", "City B").
*   **The "Line" (Cells)**: For every entity row, there is a sub-row or a visual "Line" for each selected KPI.
    *   *Example*: 
        **Store X**
        - *Line 1: # of Leads* [ Wk1: 50 ] [ Wk2: 60 ] [ Wk3: 55 ] 📈
        - *Line 2: Conversion %* [ Wk1: 10% ] [ Wk2: 15% ] [ Wk3: 12% ] 📉

#### Sorting Rule:
*   By Default, the primary row entities (e.g., all Stores) are **strictly sorted in Descending Order of `# of Leads`** calculated across the *entire selected date range*, regardless of which KPIs are currently selected in the viewer.

## 5. Technical Implementation Steps

### Step 1: Data Parsing & Week Grouping function
Create a utility function to group daily call data into standard Monday-Sunday weeks starting from the epoch of **March 2, 2025**.
*   `calculateWeekStart(dateString)` -> Returns the Monday date of that week.

### Step 2: Aggregation Engine Update
Update the backend or frontend context to map the data natively into a 3D tensor-like structure: `[Dimension] -> [Week] -> [KPIs]`.

### Step 3: Global Filter State Hook
Create state management for:
*   `selectedWeeks`: `[startDate, endDate]`
*   `selectedKPIs`: `[...kpi_keys]`
*   `selectedEntities`: `{ stores: [], cities: [], categories: [], barriers: [] }`

### Step 4: UI Development (TrendsDashboard.jsx)
1.  **Header Component**: Title, back button to Main Analytics, Subtitle.
2.  **Filter Toolbar Component**: Custom week-picker and multi-select tags for KPIs.
3.  **Trend Data Grid Component**: A highly polished, responsive table.
    *   *Sticky left column* for the Entity Name.
    *   *Horizontal overflow* for the progressing weeks.
    *   Inline CSS/SVG for sparklines inside the grid cells to visually replicate the "Line Shape" of the KPI progression.

### Step 5: Route Implementation
Update `App.jsx` to include `<Route path="/trends" element={<TrendsDashboard />} />`.
Add the CTA button exactly at the specified flex-box location in `AnalyticsDashboard.jsx`.

## 6. Default Experience Specification
Upon loading the Trends Dashboard:
1.  **Date Filter**: All available data starting `>= 2nd March 2025`.
2.  **KPI Filter**: The specified list of 8 default metrics.
3.  **Visual**: The "Store" table is shown first, showing all stores, sorted by highest volume of total leads across the full date range. This provides an immediate, zero-click analytical view of top performers over time.
