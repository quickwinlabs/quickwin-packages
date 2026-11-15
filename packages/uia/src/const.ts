// UIA 常量（枚举），值逐一从 mingw uiautomationclient.h 核对。
// 普通 enum（非 const enum）：消费方 esbuild 走 isolatedModules 转译，const enum
// 在跨模块场景会报错；运行时对象也不碍 tree-shaking。

/** TreeScope（枚举值 = UIA 位掩码；Subtree = Element|Children|Descendants = 0x7） */
export enum TreeScope {
    Element = 0x1,
    Children = 0x2,
    Descendants = 0x4,
    Parent = 0x8,
    Ancestors = 0x10,
    Subtree = 0x7,
}

/** UIA ControlType ID（部分常用项；其余见 uiautomationclient.h UIA_*ControlTypeId） */
export enum ControlType {
    Button = 50000,
    Calendar = 50001,
    CheckBox = 50002,
    ComboBox = 50003,
    Edit = 50004,
    Hyperlink = 50005,
    Image = 50006,
    ListItem = 50007,
    List = 50008,
    Menu = 50009,
    MenuBar = 50010,
    MenuItem = 50011,
    ProgressBar = 50012,
    RadioButton = 50013,
    ScrollBar = 50014,
    Slider = 50015,
    Spinner = 50016,
    StatusBar = 50017,
    Tab = 50018,
    TabItem = 50019,
    Text = 50020,
    ToolBar = 50021,
    ToolTip = 50022,
    Tree = 50023,
    TreeItem = 50024,
    Custom = 50025,
    Group = 50026,
    Thumb = 50027,
    DataGrid = 50028,
    DataItem = 50029,
    Document = 50030,
    SplitButton = 50031,
    Window = 50032,
    Pane = 50033,
    Header = 50034,
    HeaderItem = 50035,
    TitleBar = 50037,
}

/** UIA Property ID（属性条件 CreatePropertyCondition 入参；部分常用项） */
export enum PropertyId {
    RuntimeId = 30000,
    BoundingRectangle = 30001,
    ProcessId = 30002,
    ControlType = 30003,
    LocalizedControlType = 30004,
    Name = 30005,
    HasKeyboardFocus = 30008,
    IsKeyboardFocusable = 30009,
    IsEnabled = 30010,
    AutomationId = 30011,
    ClassName = 30012,
    HelpText = 30013,
    IsControlElement = 30016,
    IsContentElement = 30017,
    LabeledBy = 30018,
    IsPassword = 30019,
    NativeWindowHandle = 30020,
    ItemType = 30021,
    IsOffscreen = 30022,
    Orientation = 30023,
    FrameworkId = 30024,
    IsRequiredForForm = 30025,
    ItemStatus = 30026,
}

/** UIA Pattern ID（内部使用；GetCurrentPattern 入参，见 patterns.ts） */
export const enum PatternId {
    Invoke = 10000,
    Value = 10002,
    Scroll = 10004,
    ExpandCollapse = 10005,
    SelectionItem = 10010,
    Toggle = 10015,
}
