"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = init;
const react_1 = __importDefault(require("react"));
const path_1 = __importDefault(require("path"));
const ExportPanel_1 = __importDefault(require("./ExportPanel"));
function StaticPublisherPage(props) {
    var _a, _b, _c;
    const siteId = (_b = (_a = props.match) === null || _a === void 0 ? void 0 : _a.params) === null || _b === void 0 ? void 0 : _b.siteID;
    const site = siteId ? (_c = props.sites) === null || _c === void 0 ? void 0 : _c[siteId] : undefined;
    if (!site) {
        return react_1.default.createElement("div", { className: "esp-route-page" },
            react_1.default.createElement("p", { className: "esp-route-state" }, "Loading site \u2026"));
    }
    return react_1.default.createElement("div", { className: "esp-route-page" },
        react_1.default.createElement(ExportPanel_1.default, { site: site }));
}
function init(context) {
    const { hooks } = context;
    const { NavLink, Route } = context.ReactRouter;
    const stylesheetPath = path_1.default.resolve(__dirname, '../style.css');
    hooks.addContent('stylesheets', () => react_1.default.createElement("link", { rel: "stylesheet", key: "local-static-publisher-styles", href: stylesheetPath }));
    hooks.addContent('SiteInfo_TabNav_Items', (site) => (react_1.default.createElement(NavLink, { key: "local-static-publisher-tab", exact: true, to: `/main/site-info/${site.id}/static-publisher`, activeClassName: "active" }, "Static Publisher")));
    // Local 9/10 uses the bracketed route hook for the Site Info router. The
    // older routesSiteInfo spelling appears in legacy add-on examples but is
    // not consumed by current Local versions.
    hooks.addContent('routes[site-info]', ({ routeChildrenProps } = {}) => (react_1.default.createElement(Route, { key: "site-info-static-publisher", exact: true, path: "/main/site-info/:siteID/static-publisher", render: (props) => react_1.default.createElement(StaticPublisherPage, { ...props, ...routeChildrenProps }) })));
}
//# sourceMappingURL=renderer.js.map