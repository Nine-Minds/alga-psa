var na = (t) => {
  throw TypeError(t);
};
var Mr = (t, e, n) => e.has(t) || na("Cannot " + n);
var _ = (t, e, n) => (Mr(t, e, "read from private field"), n ? n.call(t) : e.get(t)), ce = (t, e, n) => e.has(t) ? na("Cannot add the same private member more than once") : e instanceof WeakSet ? e.add(t) : e.set(t, n), X = (t, e, n, r) => (Mr(t, e, "write to private field"), r ? r.call(t, n) : e.set(t, n), n), ge = (t, e, n) => (Mr(t, e, "access private method"), n);
import * as O from "react";
import ot, { forwardRef as gl, useImperativeHandle as xl, useEffect as Ye, createElement as $t, createContext as bl, Children as yi, useRef as yt, useState as Ae, useCallback as xe, useMemo as ra, useContext as Nl, useLayoutEffect as vl } from "react";
import "react-dom";
import { useNavigate as Nr, useParams as wi } from "react-router-dom";
function Ei(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
var Qr = { exports: {} }, tr = {};
/**
 * @license React
 * react-jsx-dev-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var sa;
function yl() {
  if (sa) return tr;
  sa = 1;
  var t = Symbol.for("react.fragment");
  return tr.Fragment = t, tr.jsxDEV = void 0, tr;
}
var nr = {};
/**
 * @license React
 * react-jsx-dev-runtime.development.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var aa;
function wl() {
  return aa || (aa = 1, process.env.NODE_ENV !== "production" && function() {
    var t = ot, e = Symbol.for("react.element"), n = Symbol.for("react.portal"), r = Symbol.for("react.fragment"), s = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), i = Symbol.for("react.provider"), l = Symbol.for("react.context"), u = Symbol.for("react.forward_ref"), f = Symbol.for("react.suspense"), d = Symbol.for("react.suspense_list"), m = Symbol.for("react.memo"), h = Symbol.for("react.lazy"), S = Symbol.for("react.offscreen"), x = Symbol.iterator, E = "@@iterator";
    function g(p) {
      if (p === null || typeof p != "object")
        return null;
      var T = x && p[x] || p[E];
      return typeof T == "function" ? T : null;
    }
    var v = t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    function b(p) {
      {
        for (var T = arguments.length, c = new Array(T > 1 ? T - 1 : 0), y = 1; y < T; y++)
          c[y - 1] = arguments[y];
        j("error", p, c);
      }
    }
    function j(p, T, c) {
      {
        var y = v.ReactDebugCurrentFrame, A = y.getStackAddendum();
        A !== "" && (T += "%s", c = c.concat([A]));
        var C = c.map(function(P) {
          return String(P);
        });
        C.unshift("Warning: " + T), Function.prototype.apply.call(console[p], console, C);
      }
    }
    var F = !1, D = !1, R = !1, k = !1, Y = !1, ue;
    ue = Symbol.for("react.module.reference");
    function ne(p) {
      return !!(typeof p == "string" || typeof p == "function" || p === r || p === a || Y || p === s || p === f || p === d || k || p === S || F || D || R || typeof p == "object" && p !== null && (p.$$typeof === h || p.$$typeof === m || p.$$typeof === i || p.$$typeof === l || p.$$typeof === u || // This needs to include all possible module reference object
      // types supported by any Flight configuration anywhere since
      // we don't know which Flight build this will end up being used
      // with.
      p.$$typeof === ue || p.getModuleId !== void 0));
    }
    function G(p, T, c) {
      var y = p.displayName;
      if (y)
        return y;
      var A = T.displayName || T.name || "";
      return A !== "" ? c + "(" + A + ")" : c;
    }
    function ae(p) {
      return p.displayName || "Context";
    }
    function q(p) {
      if (p == null)
        return null;
      if (typeof p.tag == "number" && b("Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."), typeof p == "function")
        return p.displayName || p.name || null;
      if (typeof p == "string")
        return p;
      switch (p) {
        case r:
          return "Fragment";
        case n:
          return "Portal";
        case a:
          return "Profiler";
        case s:
          return "StrictMode";
        case f:
          return "Suspense";
        case d:
          return "SuspenseList";
      }
      if (typeof p == "object")
        switch (p.$$typeof) {
          case l:
            var T = p;
            return ae(T) + ".Consumer";
          case i:
            var c = p;
            return ae(c._context) + ".Provider";
          case u:
            return G(p, p.render, "ForwardRef");
          case m:
            var y = p.displayName || null;
            return y !== null ? y : q(p.type) || "Memo";
          case h: {
            var A = p, C = A._payload, P = A._init;
            try {
              return q(P(C));
            } catch {
              return null;
            }
          }
        }
      return null;
    }
    var re = Object.assign, be = 0, Ne, dt, Je, tt, Qe, Ue, je;
    function nt() {
    }
    nt.__reactDisabledLog = !0;
    function ft() {
      {
        if (be === 0) {
          Ne = console.log, dt = console.info, Je = console.warn, tt = console.error, Qe = console.group, Ue = console.groupCollapsed, je = console.groupEnd;
          var p = {
            configurable: !0,
            enumerable: !0,
            value: nt,
            writable: !0
          };
          Object.defineProperties(console, {
            info: p,
            log: p,
            warn: p,
            error: p,
            group: p,
            groupCollapsed: p,
            groupEnd: p
          });
        }
        be++;
      }
    }
    function Be() {
      {
        if (be--, be === 0) {
          var p = {
            configurable: !0,
            enumerable: !0,
            writable: !0
          };
          Object.defineProperties(console, {
            log: re({}, p, {
              value: Ne
            }),
            info: re({}, p, {
              value: dt
            }),
            warn: re({}, p, {
              value: Je
            }),
            error: re({}, p, {
              value: tt
            }),
            group: re({}, p, {
              value: Qe
            }),
            groupCollapsed: re({}, p, {
              value: Ue
            }),
            groupEnd: re({}, p, {
              value: je
            })
          });
        }
        be < 0 && b("disabledDepth fell below zero. This is a bug in React. Please file an issue.");
      }
    }
    var ze = v.ReactCurrentDispatcher, $e;
    function Te(p, T, c) {
      {
        if ($e === void 0)
          try {
            throw Error();
          } catch (A) {
            var y = A.stack.trim().match(/\n( *(at )?)/);
            $e = y && y[1] || "";
          }
        return `
` + $e + p;
      }
    }
    var qe = !1, _e;
    {
      var mt = typeof WeakMap == "function" ? WeakMap : Map;
      _e = new mt();
    }
    function L(p, T) {
      if (!p || qe)
        return "";
      {
        var c = _e.get(p);
        if (c !== void 0)
          return c;
      }
      var y;
      qe = !0;
      var A = Error.prepareStackTrace;
      Error.prepareStackTrace = void 0;
      var C;
      C = ze.current, ze.current = null, ft();
      try {
        if (T) {
          var P = function() {
            throw Error();
          };
          if (Object.defineProperty(P.prototype, "props", {
            set: function() {
              throw Error();
            }
          }), typeof Reflect == "object" && Reflect.construct) {
            try {
              Reflect.construct(P, []);
            } catch (me) {
              y = me;
            }
            Reflect.construct(p, [], P);
          } else {
            try {
              P.call();
            } catch (me) {
              y = me;
            }
            p.call(P.prototype);
          }
        } else {
          try {
            throw Error();
          } catch (me) {
            y = me;
          }
          p();
        }
      } catch (me) {
        if (me && y && typeof me.stack == "string") {
          for (var I = me.stack.split(`
`), B = y.stack.split(`
`), M = I.length - 1, K = B.length - 1; M >= 1 && K >= 0 && I[M] !== B[K]; )
            K--;
          for (; M >= 1 && K >= 0; M--, K--)
            if (I[M] !== B[K]) {
              if (M !== 1 || K !== 1)
                do
                  if (M--, K--, K < 0 || I[M] !== B[K]) {
                    var Q = `
` + I[M].replace(" at new ", " at ");
                    return p.displayName && Q.includes("<anonymous>") && (Q = Q.replace("<anonymous>", p.displayName)), typeof p == "function" && _e.set(p, Q), Q;
                  }
                while (M >= 1 && K >= 0);
              break;
            }
        }
      } finally {
        qe = !1, ze.current = C, Be(), Error.prepareStackTrace = A;
      }
      var se = p ? p.displayName || p.name : "", he = se ? Te(se) : "";
      return typeof p == "function" && _e.set(p, he), he;
    }
    function rt(p, T, c) {
      return L(p, !1);
    }
    function st(p) {
      var T = p.prototype;
      return !!(T && T.isReactComponent);
    }
    function Re(p, T, c) {
      if (p == null)
        return "";
      if (typeof p == "function")
        return L(p, st(p));
      if (typeof p == "string")
        return Te(p);
      switch (p) {
        case f:
          return Te("Suspense");
        case d:
          return Te("SuspenseList");
      }
      if (typeof p == "object")
        switch (p.$$typeof) {
          case u:
            return rt(p.render);
          case m:
            return Re(p.type, T, c);
          case h: {
            var y = p, A = y._payload, C = y._init;
            try {
              return Re(C(A), T, c);
            } catch {
            }
          }
        }
      return "";
    }
    var ke = Object.prototype.hasOwnProperty, Ct = {}, Vt = v.ReactDebugCurrentFrame;
    function Le(p) {
      if (p) {
        var T = p._owner, c = Re(p.type, p._source, T ? T.type : null);
        Vt.setExtraStackFrame(c);
      } else
        Vt.setExtraStackFrame(null);
    }
    function Nn(p, T, c, y, A) {
      {
        var C = Function.call.bind(ke);
        for (var P in p)
          if (C(p, P)) {
            var I = void 0;
            try {
              if (typeof p[P] != "function") {
                var B = Error((y || "React class") + ": " + c + " type `" + P + "` is invalid; it must be a function, usually from the `prop-types` package, but received `" + typeof p[P] + "`.This often happens because of typos such as `PropTypes.function` instead of `PropTypes.func`.");
                throw B.name = "Invariant Violation", B;
              }
              I = p[P](T, P, y, c, null, "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED");
            } catch (M) {
              I = M;
            }
            I && !(I instanceof Error) && (Le(A), b("%s: type specification of %s `%s` is invalid; the type checker function must return `null` or an `Error` but returned a %s. You may have forgotten to pass an argument to the type checker creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and shape all require an argument).", y || "React class", c, P, typeof I), Le(null)), I instanceof Error && !(I.message in Ct) && (Ct[I.message] = !0, Le(A), b("Failed %s type: %s", c, I.message), Le(null));
          }
      }
    }
    var vn = Array.isArray;
    function N(p) {
      return vn(p);
    }
    function V(p) {
      {
        var T = typeof Symbol == "function" && Symbol.toStringTag, c = T && p[Symbol.toStringTag] || p.constructor.name || "Object";
        return c;
      }
    }
    function $(p) {
      try {
        return U(p), !1;
      } catch {
        return !0;
      }
    }
    function U(p) {
      return "" + p;
    }
    function z(p) {
      if ($(p))
        return b("The provided key is an unsupported type %s. This value must be coerced to a string before before using it here.", V(p)), U(p);
    }
    var H = v.ReactCurrentOwner, de = {
      key: !0,
      ref: !0,
      __self: !0,
      __source: !0
    }, ve, pt, ht;
    ht = {};
    function yn(p) {
      if (ke.call(p, "ref")) {
        var T = Object.getOwnPropertyDescriptor(p, "ref").get;
        if (T && T.isReactWarning)
          return !1;
      }
      return p.ref !== void 0;
    }
    function wn(p) {
      if (ke.call(p, "key")) {
        var T = Object.getOwnPropertyDescriptor(p, "key").get;
        if (T && T.isReactWarning)
          return !1;
      }
      return p.key !== void 0;
    }
    function en(p, T) {
      if (typeof p.ref == "string" && H.current && T && H.current.stateNode !== T) {
        var c = q(H.current.type);
        ht[c] || (b('Component "%s" contains the string ref "%s". Support for string refs will be removed in a future major release. This case cannot be automatically converted to an arrow function. We ask you to manually fix this case by using useRef() or createRef() instead. Learn more about using refs safely here: https://reactjs.org/link/strict-mode-string-ref', q(H.current.type), p.ref), ht[c] = !0);
      }
    }
    function En(p, T) {
      {
        var c = function() {
          ve || (ve = !0, b("%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", T));
        };
        c.isReactWarning = !0, Object.defineProperty(p, "key", {
          get: c,
          configurable: !0
        });
      }
    }
    function Pr(p, T) {
      {
        var c = function() {
          pt || (pt = !0, b("%s: `ref` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", T));
        };
        c.isReactWarning = !0, Object.defineProperty(p, "ref", {
          get: c,
          configurable: !0
        });
      }
    }
    var Ir = function(p, T, c, y, A, C, P) {
      var I = {
        // This tag allows us to uniquely identify this as a React Element
        $$typeof: e,
        // Built-in properties that belong on the element
        type: p,
        key: T,
        ref: c,
        props: P,
        // Record the component responsible for creating this element.
        _owner: C
      };
      return I._store = {}, Object.defineProperty(I._store, "validated", {
        configurable: !1,
        enumerable: !1,
        writable: !0,
        value: !1
      }), Object.defineProperty(I, "_self", {
        configurable: !1,
        enumerable: !1,
        writable: !1,
        value: y
      }), Object.defineProperty(I, "_source", {
        configurable: !1,
        enumerable: !1,
        writable: !1,
        value: A
      }), Object.freeze && (Object.freeze(I.props), Object.freeze(I)), I;
    };
    function Sn(p, T, c, y, A) {
      {
        var C, P = {}, I = null, B = null;
        c !== void 0 && (z(c), I = "" + c), wn(T) && (z(T.key), I = "" + T.key), yn(T) && (B = T.ref, en(T, A));
        for (C in T)
          ke.call(T, C) && !de.hasOwnProperty(C) && (P[C] = T[C]);
        if (p && p.defaultProps) {
          var M = p.defaultProps;
          for (C in M)
            P[C] === void 0 && (P[C] = M[C]);
        }
        if (I || B) {
          var K = typeof p == "function" ? p.displayName || p.name || "Unknown" : p;
          I && En(P, K), B && Pr(P, K);
        }
        return Ir(p, I, B, A, y, H.current, P);
      }
    }
    var tn = v.ReactCurrentOwner, gt = v.ReactDebugCurrentFrame;
    function at(p) {
      if (p) {
        var T = p._owner, c = Re(p.type, p._source, T ? T.type : null);
        gt.setExtraStackFrame(c);
      } else
        gt.setExtraStackFrame(null);
    }
    var Ft;
    Ft = !1;
    function nn(p) {
      return typeof p == "object" && p !== null && p.$$typeof === e;
    }
    function Kn() {
      {
        if (tn.current) {
          var p = q(tn.current.type);
          if (p)
            return `

Check the render method of \`` + p + "`.";
        }
        return "";
      }
    }
    function Jn(p) {
      {
        if (p !== void 0) {
          var T = p.fileName.replace(/^.*[\\\/]/, ""), c = p.lineNumber;
          return `

Check your code at ` + T + ":" + c + ".";
        }
        return "";
      }
    }
    var Qn = {};
    function Xn(p) {
      {
        var T = Kn();
        if (!T) {
          var c = typeof p == "string" ? p : p.displayName || p.name;
          c && (T = `

Check the top-level render call using <` + c + ">.");
        }
        return T;
      }
    }
    function Dn(p, T) {
      {
        if (!p._store || p._store.validated || p.key != null)
          return;
        p._store.validated = !0;
        var c = Xn(T);
        if (Qn[c])
          return;
        Qn[c] = !0;
        var y = "";
        p && p._owner && p._owner !== tn.current && (y = " It was passed a child from " + q(p._owner.type) + "."), at(p), b('Each child in a list should have a unique "key" prop.%s%s See https://reactjs.org/link/warning-keys for more information.', c, y), at(null);
      }
    }
    function Zn(p, T) {
      {
        if (typeof p != "object")
          return;
        if (N(p))
          for (var c = 0; c < p.length; c++) {
            var y = p[c];
            nn(y) && Dn(y, T);
          }
        else if (nn(p))
          p._store && (p._store.validated = !0);
        else if (p) {
          var A = g(p);
          if (typeof A == "function" && A !== p.entries)
            for (var C = A.call(p), P; !(P = C.next()).done; )
              nn(P.value) && Dn(P.value, T);
        }
      }
    }
    function $r(p) {
      {
        var T = p.type;
        if (T == null || typeof T == "string")
          return;
        var c;
        if (typeof T == "function")
          c = T.propTypes;
        else if (typeof T == "object" && (T.$$typeof === u || // Note: Memo only checks outer props here.
        // Inner props are checked in the reconciler.
        T.$$typeof === m))
          c = T.propTypes;
        else
          return;
        if (c) {
          var y = q(T);
          Nn(c, p.props, "prop", y, p);
        } else if (T.PropTypes !== void 0 && !Ft) {
          Ft = !0;
          var A = q(T);
          b("Component %s declared `PropTypes` instead of `propTypes`. Did you misspell the property assignment?", A || "Unknown");
        }
        typeof T.getDefaultProps == "function" && !T.getDefaultProps.isReactClassApproved && b("getDefaultProps is only used on classic React.createClass definitions. Use a static property named `defaultProps` instead.");
      }
    }
    function er(p) {
      {
        for (var T = Object.keys(p.props), c = 0; c < T.length; c++) {
          var y = T[c];
          if (y !== "children" && y !== "key") {
            at(p), b("Invalid prop `%s` supplied to `React.Fragment`. React.Fragment can only have `key` and `children` props.", y), at(null);
            break;
          }
        }
        p.ref !== null && (at(p), b("Invalid attribute `ref` supplied to `React.Fragment`."), at(null));
      }
    }
    var An = {};
    function kr(p, T, c, y, A, C) {
      {
        var P = ne(p);
        if (!P) {
          var I = "";
          (p === void 0 || typeof p == "object" && p !== null && Object.keys(p).length === 0) && (I += " You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports.");
          var B = Jn(A);
          B ? I += B : I += Kn();
          var M;
          p === null ? M = "null" : N(p) ? M = "array" : p !== void 0 && p.$$typeof === e ? (M = "<" + (q(p.type) || "Unknown") + " />", I = " Did you accidentally export a JSX literal instead of a component?") : M = typeof p, b("React.jsx: type is invalid -- expected a string (for built-in components) or a class/function (for composite components) but got: %s.%s", M, I);
        }
        var K = Sn(p, T, c, A, C);
        if (K == null)
          return K;
        if (P) {
          var Q = T.children;
          if (Q !== void 0)
            if (y)
              if (N(Q)) {
                for (var se = 0; se < Q.length; se++)
                  Zn(Q[se], p);
                Object.freeze && Object.freeze(Q);
              } else
                b("React.jsx: Static children should always be an array. You are likely explicitly calling React.jsxs or React.jsxDEV. Use the Babel transform instead.");
            else
              Zn(Q, p);
        }
        if (ke.call(T, "key")) {
          var he = q(p), me = Object.keys(T).filter(function(jn) {
            return jn !== "key";
          }), Xe = me.length > 0 ? "{key: someKey, " + me.join(": ..., ") + ": ...}" : "{key: someKey}";
          if (!An[he + Xe]) {
            var ye = me.length > 0 ? "{" + me.join(": ..., ") + ": ...}" : "{}";
            b(`A props object containing a "key" prop is being spread into JSX:
  let props = %s;
  <%s {...props} />
React keys must be passed directly to JSX without using spread:
  let props = %s;
  <%s key={someKey} {...props} />`, Xe, he, ye, he), An[he + Xe] = !0;
          }
        }
        return p === r ? er(K) : $r(K), K;
      }
    }
    var Lr = kr;
    nr.Fragment = r, nr.jsxDEV = Lr;
  }()), nr;
}
process.env.NODE_ENV === "production" ? Qr.exports = yl() : Qr.exports = wl();
var o = Qr.exports;
const Ag = ({
  path: t = "/softwareone/agreements",
  displayName: e = "SoftwareOne",
  label: n,
  isActive: r = !1,
  collapsed: s = !1
}) => {
  const a = () => {
    window.location.href = t;
  };
  return /* @__PURE__ */ o.jsxDEV(
    "button",
    {
      onClick: a,
      className: `w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${r ? "bg-[#2a2b32] text-white" : "text-gray-300 hover:bg-[#2a2b32] hover:text-white"}`,
      children: [
        /* @__PURE__ */ o.jsxDEV(
          "svg",
          {
            className: "w-5 h-5",
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            xmlns: "http://www.w3.org/2000/svg",
            children: /* @__PURE__ */ o.jsxDEV(
              "path",
              {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: 2,
                d: "M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
              },
              void 0,
              !1,
              {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/components/NavItem.tsx",
                lineNumber: 40,
                columnNumber: 9
              },
              void 0
            )
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/components/NavItem.tsx",
            lineNumber: 33,
            columnNumber: 7
          },
          void 0
        ),
        !s && /* @__PURE__ */ o.jsxDEV("span", { children: n || e }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/components/NavItem.tsx",
          lineNumber: 47,
          columnNumber: 22
        }, void 0)
      ]
    },
    void 0,
    !0,
    {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/components/NavItem.tsx",
      lineNumber: 25,
      columnNumber: 5
    },
    void 0
  );
};
var El = function(e) {
  return Sl(e) && !Dl(e);
};
function Sl(t) {
  return !!t && typeof t == "object";
}
function Dl(t) {
  var e = Object.prototype.toString.call(t);
  return e === "[object RegExp]" || e === "[object Date]" || Tl(t);
}
var Al = typeof Symbol == "function" && Symbol.for, jl = Al ? Symbol.for("react.element") : 60103;
function Tl(t) {
  return t.$$typeof === jl;
}
function _l(t) {
  return Array.isArray(t) ? [] : {};
}
function fr(t, e) {
  return e.clone !== !1 && e.isMergeableObject(t) ? In(_l(t), t, e) : t;
}
function Rl(t, e, n) {
  return t.concat(e).map(function(r) {
    return fr(r, n);
  });
}
function Ol(t, e, n) {
  var r = {};
  return n.isMergeableObject(t) && Object.keys(t).forEach(function(s) {
    r[s] = fr(t[s], n);
  }), Object.keys(e).forEach(function(s) {
    !n.isMergeableObject(e[s]) || !t[s] ? r[s] = fr(e[s], n) : r[s] = In(t[s], e[s], n);
  }), r;
}
function In(t, e, n) {
  n = n || {}, n.arrayMerge = n.arrayMerge || Rl, n.isMergeableObject = n.isMergeableObject || El;
  var r = Array.isArray(e), s = Array.isArray(t), a = r === s;
  return a ? r ? n.arrayMerge(t, e, n) : Ol(t, e, n) : fr(e, n);
}
In.all = function(e, n) {
  if (!Array.isArray(e))
    throw new Error("first argument should be an array");
  return e.reduce(function(r, s) {
    return In(r, s, n);
  }, {});
};
var Xr = In, Si = typeof global == "object" && global && global.Object === Object && global, Cl = typeof self == "object" && self && self.Object === Object && self, ct = Si || Cl || Function("return this")(), Rt = ct.Symbol, Di = Object.prototype, Vl = Di.hasOwnProperty, Fl = Di.toString, Tn = Rt ? Rt.toStringTag : void 0;
function Pl(t) {
  var e = Vl.call(t, Tn), n = t[Tn];
  try {
    t[Tn] = void 0;
    var r = !0;
  } catch {
  }
  var s = Fl.call(t);
  return r && (e ? t[Tn] = n : delete t[Tn]), s;
}
var Il = Object.prototype, $l = Il.toString;
function kl(t) {
  return $l.call(t);
}
var Ll = "[object Null]", Ml = "[object Undefined]", ia = Rt ? Rt.toStringTag : void 0;
function Gt(t) {
  return t == null ? t === void 0 ? Ml : Ll : ia && ia in Object(t) ? Pl(t) : kl(t);
}
function Ai(t, e) {
  return function(n) {
    return t(e(n));
  };
}
var Os = Ai(Object.getPrototypeOf, Object);
function Kt(t) {
  return t != null && typeof t == "object";
}
var Ul = "[object Object]", Bl = Function.prototype, zl = Object.prototype, ji = Bl.toString, ql = zl.hasOwnProperty, Wl = ji.call(Object);
function oa(t) {
  if (!Kt(t) || Gt(t) != Ul)
    return !1;
  var e = Os(t);
  if (e === null)
    return !0;
  var n = ql.call(e, "constructor") && e.constructor;
  return typeof n == "function" && n instanceof n && ji.call(n) == Wl;
}
function Yl() {
  this.__data__ = [], this.size = 0;
}
function Ti(t, e) {
  return t === e || t !== t && e !== e;
}
function vr(t, e) {
  for (var n = t.length; n--; )
    if (Ti(t[n][0], e))
      return n;
  return -1;
}
var Hl = Array.prototype, Gl = Hl.splice;
function Kl(t) {
  var e = this.__data__, n = vr(e, t);
  if (n < 0)
    return !1;
  var r = e.length - 1;
  return n == r ? e.pop() : Gl.call(e, n, 1), --this.size, !0;
}
function Jl(t) {
  var e = this.__data__, n = vr(e, t);
  return n < 0 ? void 0 : e[n][1];
}
function Ql(t) {
  return vr(this.__data__, t) > -1;
}
function Xl(t, e) {
  var n = this.__data__, r = vr(n, t);
  return r < 0 ? (++this.size, n.push([t, e])) : n[r][1] = e, this;
}
function vt(t) {
  var e = -1, n = t == null ? 0 : t.length;
  for (this.clear(); ++e < n; ) {
    var r = t[e];
    this.set(r[0], r[1]);
  }
}
vt.prototype.clear = Yl;
vt.prototype.delete = Kl;
vt.prototype.get = Jl;
vt.prototype.has = Ql;
vt.prototype.set = Xl;
function Zl() {
  this.__data__ = new vt(), this.size = 0;
}
function eu(t) {
  var e = this.__data__, n = e.delete(t);
  return this.size = e.size, n;
}
function tu(t) {
  return this.__data__.get(t);
}
function nu(t) {
  return this.__data__.has(t);
}
function zn(t) {
  var e = typeof t;
  return t != null && (e == "object" || e == "function");
}
var ru = "[object AsyncFunction]", su = "[object Function]", au = "[object GeneratorFunction]", iu = "[object Proxy]";
function _i(t) {
  if (!zn(t))
    return !1;
  var e = Gt(t);
  return e == su || e == au || e == ru || e == iu;
}
var Ur = ct["__core-js_shared__"], la = function() {
  var t = /[^.]+$/.exec(Ur && Ur.keys && Ur.keys.IE_PROTO || "");
  return t ? "Symbol(src)_1." + t : "";
}();
function ou(t) {
  return !!la && la in t;
}
var lu = Function.prototype, uu = lu.toString;
function Jt(t) {
  if (t != null) {
    try {
      return uu.call(t);
    } catch {
    }
    try {
      return t + "";
    } catch {
    }
  }
  return "";
}
var cu = /[\\^$.*+?()[\]{}|]/g, du = /^\[object .+?Constructor\]$/, fu = Function.prototype, mu = Object.prototype, pu = fu.toString, hu = mu.hasOwnProperty, gu = RegExp(
  "^" + pu.call(hu).replace(cu, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$"
);
function xu(t) {
  if (!zn(t) || ou(t))
    return !1;
  var e = _i(t) ? gu : du;
  return e.test(Jt(t));
}
function bu(t, e) {
  return t == null ? void 0 : t[e];
}
function Qt(t, e) {
  var n = bu(t, e);
  return xu(n) ? n : void 0;
}
var $n = Qt(ct, "Map"), kn = Qt(Object, "create");
function Nu() {
  this.__data__ = kn ? kn(null) : {}, this.size = 0;
}
function vu(t) {
  var e = this.has(t) && delete this.__data__[t];
  return this.size -= e ? 1 : 0, e;
}
var yu = "__lodash_hash_undefined__", wu = Object.prototype, Eu = wu.hasOwnProperty;
function Su(t) {
  var e = this.__data__;
  if (kn) {
    var n = e[t];
    return n === yu ? void 0 : n;
  }
  return Eu.call(e, t) ? e[t] : void 0;
}
var Du = Object.prototype, Au = Du.hasOwnProperty;
function ju(t) {
  var e = this.__data__;
  return kn ? e[t] !== void 0 : Au.call(e, t);
}
var Tu = "__lodash_hash_undefined__";
function _u(t, e) {
  var n = this.__data__;
  return this.size += this.has(t) ? 0 : 1, n[t] = kn && e === void 0 ? Tu : e, this;
}
function Yt(t) {
  var e = -1, n = t == null ? 0 : t.length;
  for (this.clear(); ++e < n; ) {
    var r = t[e];
    this.set(r[0], r[1]);
  }
}
Yt.prototype.clear = Nu;
Yt.prototype.delete = vu;
Yt.prototype.get = Su;
Yt.prototype.has = ju;
Yt.prototype.set = _u;
function Ru() {
  this.size = 0, this.__data__ = {
    hash: new Yt(),
    map: new ($n || vt)(),
    string: new Yt()
  };
}
function Ou(t) {
  var e = typeof t;
  return e == "string" || e == "number" || e == "symbol" || e == "boolean" ? t !== "__proto__" : t === null;
}
function yr(t, e) {
  var n = t.__data__;
  return Ou(e) ? n[typeof e == "string" ? "string" : "hash"] : n.map;
}
function Cu(t) {
  var e = yr(this, t).delete(t);
  return this.size -= e ? 1 : 0, e;
}
function Vu(t) {
  return yr(this, t).get(t);
}
function Fu(t) {
  return yr(this, t).has(t);
}
function Pu(t, e) {
  var n = yr(this, t), r = n.size;
  return n.set(t, e), this.size += n.size == r ? 0 : 1, this;
}
function Ot(t) {
  var e = -1, n = t == null ? 0 : t.length;
  for (this.clear(); ++e < n; ) {
    var r = t[e];
    this.set(r[0], r[1]);
  }
}
Ot.prototype.clear = Ru;
Ot.prototype.delete = Cu;
Ot.prototype.get = Vu;
Ot.prototype.has = Fu;
Ot.prototype.set = Pu;
var Iu = 200;
function $u(t, e) {
  var n = this.__data__;
  if (n instanceof vt) {
    var r = n.__data__;
    if (!$n || r.length < Iu - 1)
      return r.push([t, e]), this.size = ++n.size, this;
    n = this.__data__ = new Ot(r);
  }
  return n.set(t, e), this.size = n.size, this;
}
function hn(t) {
  var e = this.__data__ = new vt(t);
  this.size = e.size;
}
hn.prototype.clear = Zl;
hn.prototype.delete = eu;
hn.prototype.get = tu;
hn.prototype.has = nu;
hn.prototype.set = $u;
function ku(t, e) {
  for (var n = -1, r = t == null ? 0 : t.length; ++n < r && e(t[n], n, t) !== !1; )
    ;
  return t;
}
var ua = function() {
  try {
    var t = Qt(Object, "defineProperty");
    return t({}, "", {}), t;
  } catch {
  }
}();
function Ri(t, e, n) {
  e == "__proto__" && ua ? ua(t, e, {
    configurable: !0,
    enumerable: !0,
    value: n,
    writable: !0
  }) : t[e] = n;
}
var Lu = Object.prototype, Mu = Lu.hasOwnProperty;
function Oi(t, e, n) {
  var r = t[e];
  (!(Mu.call(t, e) && Ti(r, n)) || n === void 0 && !(e in t)) && Ri(t, e, n);
}
function wr(t, e, n, r) {
  var s = !n;
  n || (n = {});
  for (var a = -1, i = e.length; ++a < i; ) {
    var l = e[a], u = void 0;
    u === void 0 && (u = t[l]), s ? Ri(n, l, u) : Oi(n, l, u);
  }
  return n;
}
function Uu(t, e) {
  for (var n = -1, r = Array(t); ++n < t; )
    r[n] = e(n);
  return r;
}
var Bu = "[object Arguments]";
function ca(t) {
  return Kt(t) && Gt(t) == Bu;
}
var Ci = Object.prototype, zu = Ci.hasOwnProperty, qu = Ci.propertyIsEnumerable, Wu = ca(/* @__PURE__ */ function() {
  return arguments;
}()) ? ca : function(t) {
  return Kt(t) && zu.call(t, "callee") && !qu.call(t, "callee");
}, qn = Array.isArray;
function Yu() {
  return !1;
}
var Vi = typeof exports == "object" && exports && !exports.nodeType && exports, da = Vi && typeof module == "object" && module && !module.nodeType && module, Hu = da && da.exports === Vi, fa = Hu ? ct.Buffer : void 0, Gu = fa ? fa.isBuffer : void 0, Fi = Gu || Yu, Ku = 9007199254740991, Ju = /^(?:0|[1-9]\d*)$/;
function Qu(t, e) {
  var n = typeof t;
  return e = e ?? Ku, !!e && (n == "number" || n != "symbol" && Ju.test(t)) && t > -1 && t % 1 == 0 && t < e;
}
var Xu = 9007199254740991;
function Pi(t) {
  return typeof t == "number" && t > -1 && t % 1 == 0 && t <= Xu;
}
var Zu = "[object Arguments]", ec = "[object Array]", tc = "[object Boolean]", nc = "[object Date]", rc = "[object Error]", sc = "[object Function]", ac = "[object Map]", ic = "[object Number]", oc = "[object Object]", lc = "[object RegExp]", uc = "[object Set]", cc = "[object String]", dc = "[object WeakMap]", fc = "[object ArrayBuffer]", mc = "[object DataView]", pc = "[object Float32Array]", hc = "[object Float64Array]", gc = "[object Int8Array]", xc = "[object Int16Array]", bc = "[object Int32Array]", Nc = "[object Uint8Array]", vc = "[object Uint8ClampedArray]", yc = "[object Uint16Array]", wc = "[object Uint32Array]", oe = {};
oe[pc] = oe[hc] = oe[gc] = oe[xc] = oe[bc] = oe[Nc] = oe[vc] = oe[yc] = oe[wc] = !0;
oe[Zu] = oe[ec] = oe[fc] = oe[tc] = oe[mc] = oe[nc] = oe[rc] = oe[sc] = oe[ac] = oe[ic] = oe[oc] = oe[lc] = oe[uc] = oe[cc] = oe[dc] = !1;
function Ec(t) {
  return Kt(t) && Pi(t.length) && !!oe[Gt(t)];
}
function Cs(t) {
  return function(e) {
    return t(e);
  };
}
var Ii = typeof exports == "object" && exports && !exports.nodeType && exports, Vn = Ii && typeof module == "object" && module && !module.nodeType && module, Sc = Vn && Vn.exports === Ii, Br = Sc && Si.process, pn = function() {
  try {
    var t = Vn && Vn.require && Vn.require("util").types;
    return t || Br && Br.binding && Br.binding("util");
  } catch {
  }
}(), ma = pn && pn.isTypedArray, Dc = ma ? Cs(ma) : Ec, Ac = Object.prototype, jc = Ac.hasOwnProperty;
function $i(t, e) {
  var n = qn(t), r = !n && Wu(t), s = !n && !r && Fi(t), a = !n && !r && !s && Dc(t), i = n || r || s || a, l = i ? Uu(t.length, String) : [], u = l.length;
  for (var f in t)
    (e || jc.call(t, f)) && !(i && // Safari 9 has enumerable `arguments.length` in strict mode.
    (f == "length" || // Node.js 0.10 has enumerable non-index properties on buffers.
    s && (f == "offset" || f == "parent") || // PhantomJS 2 has enumerable non-index properties on typed arrays.
    a && (f == "buffer" || f == "byteLength" || f == "byteOffset") || // Skip index properties.
    Qu(f, u))) && l.push(f);
  return l;
}
var Tc = Object.prototype;
function Vs(t) {
  var e = t && t.constructor, n = typeof e == "function" && e.prototype || Tc;
  return t === n;
}
var _c = Ai(Object.keys, Object), Rc = Object.prototype, Oc = Rc.hasOwnProperty;
function Cc(t) {
  if (!Vs(t))
    return _c(t);
  var e = [];
  for (var n in Object(t))
    Oc.call(t, n) && n != "constructor" && e.push(n);
  return e;
}
function ki(t) {
  return t != null && Pi(t.length) && !_i(t);
}
function Fs(t) {
  return ki(t) ? $i(t) : Cc(t);
}
function Vc(t, e) {
  return t && wr(e, Fs(e), t);
}
function Fc(t) {
  var e = [];
  if (t != null)
    for (var n in Object(t))
      e.push(n);
  return e;
}
var Pc = Object.prototype, Ic = Pc.hasOwnProperty;
function $c(t) {
  if (!zn(t))
    return Fc(t);
  var e = Vs(t), n = [];
  for (var r in t)
    r == "constructor" && (e || !Ic.call(t, r)) || n.push(r);
  return n;
}
function Ps(t) {
  return ki(t) ? $i(t, !0) : $c(t);
}
function kc(t, e) {
  return t && wr(e, Ps(e), t);
}
var Li = typeof exports == "object" && exports && !exports.nodeType && exports, pa = Li && typeof module == "object" && module && !module.nodeType && module, Lc = pa && pa.exports === Li, ha = Lc ? ct.Buffer : void 0, ga = ha ? ha.allocUnsafe : void 0;
function Mc(t, e) {
  if (e)
    return t.slice();
  var n = t.length, r = ga ? ga(n) : new t.constructor(n);
  return t.copy(r), r;
}
function Mi(t, e) {
  var n = -1, r = t.length;
  for (e || (e = Array(r)); ++n < r; )
    e[n] = t[n];
  return e;
}
function Uc(t, e) {
  for (var n = -1, r = t == null ? 0 : t.length, s = 0, a = []; ++n < r; ) {
    var i = t[n];
    e(i, n, t) && (a[s++] = i);
  }
  return a;
}
function Ui() {
  return [];
}
var Bc = Object.prototype, zc = Bc.propertyIsEnumerable, xa = Object.getOwnPropertySymbols, Is = xa ? function(t) {
  return t == null ? [] : (t = Object(t), Uc(xa(t), function(e) {
    return zc.call(t, e);
  }));
} : Ui;
function qc(t, e) {
  return wr(t, Is(t), e);
}
function Bi(t, e) {
  for (var n = -1, r = e.length, s = t.length; ++n < r; )
    t[s + n] = e[n];
  return t;
}
var Wc = Object.getOwnPropertySymbols, zi = Wc ? function(t) {
  for (var e = []; t; )
    Bi(e, Is(t)), t = Os(t);
  return e;
} : Ui;
function Yc(t, e) {
  return wr(t, zi(t), e);
}
function qi(t, e, n) {
  var r = e(t);
  return qn(t) ? r : Bi(r, n(t));
}
function Hc(t) {
  return qi(t, Fs, Is);
}
function Gc(t) {
  return qi(t, Ps, zi);
}
var Zr = Qt(ct, "DataView"), es = Qt(ct, "Promise"), ts = Qt(ct, "Set"), ns = Qt(ct, "WeakMap"), ba = "[object Map]", Kc = "[object Object]", Na = "[object Promise]", va = "[object Set]", ya = "[object WeakMap]", wa = "[object DataView]", Jc = Jt(Zr), Qc = Jt($n), Xc = Jt(es), Zc = Jt(ts), ed = Jt(ns), bt = Gt;
(Zr && bt(new Zr(new ArrayBuffer(1))) != wa || $n && bt(new $n()) != ba || es && bt(es.resolve()) != Na || ts && bt(new ts()) != va || ns && bt(new ns()) != ya) && (bt = function(t) {
  var e = Gt(t), n = e == Kc ? t.constructor : void 0, r = n ? Jt(n) : "";
  if (r)
    switch (r) {
      case Jc:
        return wa;
      case Qc:
        return ba;
      case Xc:
        return Na;
      case Zc:
        return va;
      case ed:
        return ya;
    }
  return e;
});
var td = Object.prototype, nd = td.hasOwnProperty;
function rd(t) {
  var e = t.length, n = new t.constructor(e);
  return e && typeof t[0] == "string" && nd.call(t, "index") && (n.index = t.index, n.input = t.input), n;
}
var Ea = ct.Uint8Array;
function $s(t) {
  var e = new t.constructor(t.byteLength);
  return new Ea(e).set(new Ea(t)), e;
}
function sd(t, e) {
  var n = e ? $s(t.buffer) : t.buffer;
  return new t.constructor(n, t.byteOffset, t.byteLength);
}
var ad = /\w*$/;
function id(t) {
  var e = new t.constructor(t.source, ad.exec(t));
  return e.lastIndex = t.lastIndex, e;
}
var Sa = Rt ? Rt.prototype : void 0, Da = Sa ? Sa.valueOf : void 0;
function od(t) {
  return Da ? Object(Da.call(t)) : {};
}
function ld(t, e) {
  var n = e ? $s(t.buffer) : t.buffer;
  return new t.constructor(n, t.byteOffset, t.length);
}
var ud = "[object Boolean]", cd = "[object Date]", dd = "[object Map]", fd = "[object Number]", md = "[object RegExp]", pd = "[object Set]", hd = "[object String]", gd = "[object Symbol]", xd = "[object ArrayBuffer]", bd = "[object DataView]", Nd = "[object Float32Array]", vd = "[object Float64Array]", yd = "[object Int8Array]", wd = "[object Int16Array]", Ed = "[object Int32Array]", Sd = "[object Uint8Array]", Dd = "[object Uint8ClampedArray]", Ad = "[object Uint16Array]", jd = "[object Uint32Array]";
function Td(t, e, n) {
  var r = t.constructor;
  switch (e) {
    case xd:
      return $s(t);
    case ud:
    case cd:
      return new r(+t);
    case bd:
      return sd(t, n);
    case Nd:
    case vd:
    case yd:
    case wd:
    case Ed:
    case Sd:
    case Dd:
    case Ad:
    case jd:
      return ld(t, n);
    case dd:
      return new r();
    case fd:
    case hd:
      return new r(t);
    case md:
      return id(t);
    case pd:
      return new r();
    case gd:
      return od(t);
  }
}
var Aa = Object.create, _d = /* @__PURE__ */ function() {
  function t() {
  }
  return function(e) {
    if (!zn(e))
      return {};
    if (Aa)
      return Aa(e);
    t.prototype = e;
    var n = new t();
    return t.prototype = void 0, n;
  };
}();
function Rd(t) {
  return typeof t.constructor == "function" && !Vs(t) ? _d(Os(t)) : {};
}
var Od = "[object Map]";
function Cd(t) {
  return Kt(t) && bt(t) == Od;
}
var ja = pn && pn.isMap, Vd = ja ? Cs(ja) : Cd, Fd = "[object Set]";
function Pd(t) {
  return Kt(t) && bt(t) == Fd;
}
var Ta = pn && pn.isSet, Id = Ta ? Cs(Ta) : Pd, $d = 1, kd = 2, Ld = 4, Wi = "[object Arguments]", Md = "[object Array]", Ud = "[object Boolean]", Bd = "[object Date]", zd = "[object Error]", Yi = "[object Function]", qd = "[object GeneratorFunction]", Wd = "[object Map]", Yd = "[object Number]", Hi = "[object Object]", Hd = "[object RegExp]", Gd = "[object Set]", Kd = "[object String]", Jd = "[object Symbol]", Qd = "[object WeakMap]", Xd = "[object ArrayBuffer]", Zd = "[object DataView]", ef = "[object Float32Array]", tf = "[object Float64Array]", nf = "[object Int8Array]", rf = "[object Int16Array]", sf = "[object Int32Array]", af = "[object Uint8Array]", of = "[object Uint8ClampedArray]", lf = "[object Uint16Array]", uf = "[object Uint32Array]", ie = {};
ie[Wi] = ie[Md] = ie[Xd] = ie[Zd] = ie[Ud] = ie[Bd] = ie[ef] = ie[tf] = ie[nf] = ie[rf] = ie[sf] = ie[Wd] = ie[Yd] = ie[Hi] = ie[Hd] = ie[Gd] = ie[Kd] = ie[Jd] = ie[af] = ie[of] = ie[lf] = ie[uf] = !0;
ie[zd] = ie[Yi] = ie[Qd] = !1;
function Fn(t, e, n, r, s, a) {
  var i, l = e & $d, u = e & kd, f = e & Ld;
  if (i !== void 0)
    return i;
  if (!zn(t))
    return t;
  var d = qn(t);
  if (d) {
    if (i = rd(t), !l)
      return Mi(t, i);
  } else {
    var m = bt(t), h = m == Yi || m == qd;
    if (Fi(t))
      return Mc(t, l);
    if (m == Hi || m == Wi || h && !s) {
      if (i = u || h ? {} : Rd(t), !l)
        return u ? Yc(t, kc(i, t)) : qc(t, Vc(i, t));
    } else {
      if (!ie[m])
        return s ? t : {};
      i = Td(t, m, l);
    }
  }
  a || (a = new hn());
  var S = a.get(t);
  if (S)
    return S;
  a.set(t, i), Id(t) ? t.forEach(function(g) {
    i.add(Fn(g, e, n, g, t, a));
  }) : Vd(t) && t.forEach(function(g, v) {
    i.set(v, Fn(g, e, n, v, t, a));
  });
  var x = f ? u ? Gc : Hc : u ? Ps : Fs, E = d ? void 0 : x(t);
  return ku(E || t, function(g, v) {
    E && (v = g, g = t[v]), Oi(i, v, Fn(g, e, n, v, t, a));
  }), i;
}
var cf = 1, df = 4;
function rr(t) {
  return Fn(t, cf | df);
}
var _a = Array.isArray, Ra = Object.keys, ff = Object.prototype.hasOwnProperty, mf = typeof Element < "u";
function rs(t, e) {
  if (t === e) return !0;
  if (t && e && typeof t == "object" && typeof e == "object") {
    var n = _a(t), r = _a(e), s, a, i;
    if (n && r) {
      if (a = t.length, a != e.length) return !1;
      for (s = a; s-- !== 0; )
        if (!rs(t[s], e[s])) return !1;
      return !0;
    }
    if (n != r) return !1;
    var l = t instanceof Date, u = e instanceof Date;
    if (l != u) return !1;
    if (l && u) return t.getTime() == e.getTime();
    var f = t instanceof RegExp, d = e instanceof RegExp;
    if (f != d) return !1;
    if (f && d) return t.toString() == e.toString();
    var m = Ra(t);
    if (a = m.length, a !== Ra(e).length)
      return !1;
    for (s = a; s-- !== 0; )
      if (!ff.call(e, m[s])) return !1;
    if (mf && t instanceof Element && e instanceof Element)
      return t === e;
    for (s = a; s-- !== 0; )
      if (i = m[s], !(i === "_owner" && t.$$typeof) && !rs(t[i], e[i]))
        return !1;
    return !0;
  }
  return t !== t && e !== e;
}
var pf = function(e, n) {
  try {
    return rs(e, n);
  } catch (r) {
    if (r.message && r.message.match(/stack|recursion/i) || r.number === -2146828260)
      return console.warn("Warning: react-fast-compare does not handle circular references.", r.name, r.message), !1;
    throw r;
  }
};
const It = /* @__PURE__ */ Ei(pf);
var hf = process.env.NODE_ENV === "production";
function we(t, e) {
  if (!hf) {
    var n = "Warning: " + e;
    typeof console < "u" && console.warn(n);
    try {
      throw Error(n);
    } catch {
    }
  }
}
var gf = 4;
function Oa(t) {
  return Fn(t, gf);
}
function Gi(t, e) {
  for (var n = -1, r = t == null ? 0 : t.length, s = Array(r); ++n < r; )
    s[n] = e(t[n], n, t);
  return s;
}
var xf = "[object Symbol]";
function ks(t) {
  return typeof t == "symbol" || Kt(t) && Gt(t) == xf;
}
var bf = "Expected a function";
function Ls(t, e) {
  if (typeof t != "function" || e != null && typeof e != "function")
    throw new TypeError(bf);
  var n = function() {
    var r = arguments, s = e ? e.apply(this, r) : r[0], a = n.cache;
    if (a.has(s))
      return a.get(s);
    var i = t.apply(this, r);
    return n.cache = a.set(s, i) || a, i;
  };
  return n.cache = new (Ls.Cache || Ot)(), n;
}
Ls.Cache = Ot;
var Nf = 500;
function vf(t) {
  var e = Ls(t, function(r) {
    return n.size === Nf && n.clear(), r;
  }), n = e.cache;
  return e;
}
var yf = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g, wf = /\\(\\)?/g, Ef = vf(function(t) {
  var e = [];
  return t.charCodeAt(0) === 46 && e.push(""), t.replace(yf, function(n, r, s, a) {
    e.push(s ? a.replace(wf, "$1") : r || n);
  }), e;
});
function Sf(t) {
  if (typeof t == "string" || ks(t))
    return t;
  var e = t + "";
  return e == "0" && 1 / t == -1 / 0 ? "-0" : e;
}
var Ca = Rt ? Rt.prototype : void 0, Va = Ca ? Ca.toString : void 0;
function Ki(t) {
  if (typeof t == "string")
    return t;
  if (qn(t))
    return Gi(t, Ki) + "";
  if (ks(t))
    return Va ? Va.call(t) : "";
  var e = t + "";
  return e == "0" && 1 / t == -1 / 0 ? "-0" : e;
}
function Df(t) {
  return t == null ? "" : Ki(t);
}
function Ji(t) {
  return qn(t) ? Gi(t, Sf) : ks(t) ? [t] : Mi(Ef(Df(t)));
}
var ss = { exports: {} }, Z = {};
/** @license React v16.13.1
 * react-is.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Fa;
function Af() {
  if (Fa) return Z;
  Fa = 1;
  var t = typeof Symbol == "function" && Symbol.for, e = t ? Symbol.for("react.element") : 60103, n = t ? Symbol.for("react.portal") : 60106, r = t ? Symbol.for("react.fragment") : 60107, s = t ? Symbol.for("react.strict_mode") : 60108, a = t ? Symbol.for("react.profiler") : 60114, i = t ? Symbol.for("react.provider") : 60109, l = t ? Symbol.for("react.context") : 60110, u = t ? Symbol.for("react.async_mode") : 60111, f = t ? Symbol.for("react.concurrent_mode") : 60111, d = t ? Symbol.for("react.forward_ref") : 60112, m = t ? Symbol.for("react.suspense") : 60113, h = t ? Symbol.for("react.suspense_list") : 60120, S = t ? Symbol.for("react.memo") : 60115, x = t ? Symbol.for("react.lazy") : 60116, E = t ? Symbol.for("react.block") : 60121, g = t ? Symbol.for("react.fundamental") : 60117, v = t ? Symbol.for("react.responder") : 60118, b = t ? Symbol.for("react.scope") : 60119;
  function j(D) {
    if (typeof D == "object" && D !== null) {
      var R = D.$$typeof;
      switch (R) {
        case e:
          switch (D = D.type, D) {
            case u:
            case f:
            case r:
            case a:
            case s:
            case m:
              return D;
            default:
              switch (D = D && D.$$typeof, D) {
                case l:
                case d:
                case x:
                case S:
                case i:
                  return D;
                default:
                  return R;
              }
          }
        case n:
          return R;
      }
    }
  }
  function F(D) {
    return j(D) === f;
  }
  return Z.AsyncMode = u, Z.ConcurrentMode = f, Z.ContextConsumer = l, Z.ContextProvider = i, Z.Element = e, Z.ForwardRef = d, Z.Fragment = r, Z.Lazy = x, Z.Memo = S, Z.Portal = n, Z.Profiler = a, Z.StrictMode = s, Z.Suspense = m, Z.isAsyncMode = function(D) {
    return F(D) || j(D) === u;
  }, Z.isConcurrentMode = F, Z.isContextConsumer = function(D) {
    return j(D) === l;
  }, Z.isContextProvider = function(D) {
    return j(D) === i;
  }, Z.isElement = function(D) {
    return typeof D == "object" && D !== null && D.$$typeof === e;
  }, Z.isForwardRef = function(D) {
    return j(D) === d;
  }, Z.isFragment = function(D) {
    return j(D) === r;
  }, Z.isLazy = function(D) {
    return j(D) === x;
  }, Z.isMemo = function(D) {
    return j(D) === S;
  }, Z.isPortal = function(D) {
    return j(D) === n;
  }, Z.isProfiler = function(D) {
    return j(D) === a;
  }, Z.isStrictMode = function(D) {
    return j(D) === s;
  }, Z.isSuspense = function(D) {
    return j(D) === m;
  }, Z.isValidElementType = function(D) {
    return typeof D == "string" || typeof D == "function" || D === r || D === f || D === a || D === s || D === m || D === h || typeof D == "object" && D !== null && (D.$$typeof === x || D.$$typeof === S || D.$$typeof === i || D.$$typeof === l || D.$$typeof === d || D.$$typeof === g || D.$$typeof === v || D.$$typeof === b || D.$$typeof === E);
  }, Z.typeOf = j, Z;
}
var ee = {};
/** @license React v16.13.1
 * react-is.development.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Pa;
function jf() {
  return Pa || (Pa = 1, process.env.NODE_ENV !== "production" && function() {
    var t = typeof Symbol == "function" && Symbol.for, e = t ? Symbol.for("react.element") : 60103, n = t ? Symbol.for("react.portal") : 60106, r = t ? Symbol.for("react.fragment") : 60107, s = t ? Symbol.for("react.strict_mode") : 60108, a = t ? Symbol.for("react.profiler") : 60114, i = t ? Symbol.for("react.provider") : 60109, l = t ? Symbol.for("react.context") : 60110, u = t ? Symbol.for("react.async_mode") : 60111, f = t ? Symbol.for("react.concurrent_mode") : 60111, d = t ? Symbol.for("react.forward_ref") : 60112, m = t ? Symbol.for("react.suspense") : 60113, h = t ? Symbol.for("react.suspense_list") : 60120, S = t ? Symbol.for("react.memo") : 60115, x = t ? Symbol.for("react.lazy") : 60116, E = t ? Symbol.for("react.block") : 60121, g = t ? Symbol.for("react.fundamental") : 60117, v = t ? Symbol.for("react.responder") : 60118, b = t ? Symbol.for("react.scope") : 60119;
    function j(L) {
      return typeof L == "string" || typeof L == "function" || // Note: its typeof might be other than 'symbol' or 'number' if it's a polyfill.
      L === r || L === f || L === a || L === s || L === m || L === h || typeof L == "object" && L !== null && (L.$$typeof === x || L.$$typeof === S || L.$$typeof === i || L.$$typeof === l || L.$$typeof === d || L.$$typeof === g || L.$$typeof === v || L.$$typeof === b || L.$$typeof === E);
    }
    function F(L) {
      if (typeof L == "object" && L !== null) {
        var rt = L.$$typeof;
        switch (rt) {
          case e:
            var st = L.type;
            switch (st) {
              case u:
              case f:
              case r:
              case a:
              case s:
              case m:
                return st;
              default:
                var Re = st && st.$$typeof;
                switch (Re) {
                  case l:
                  case d:
                  case x:
                  case S:
                  case i:
                    return Re;
                  default:
                    return rt;
                }
            }
          case n:
            return rt;
        }
      }
    }
    var D = u, R = f, k = l, Y = i, ue = e, ne = d, G = r, ae = x, q = S, re = n, be = a, Ne = s, dt = m, Je = !1;
    function tt(L) {
      return Je || (Je = !0, console.warn("The ReactIs.isAsyncMode() alias has been deprecated, and will be removed in React 17+. Update your code to use ReactIs.isConcurrentMode() instead. It has the exact same API.")), Qe(L) || F(L) === u;
    }
    function Qe(L) {
      return F(L) === f;
    }
    function Ue(L) {
      return F(L) === l;
    }
    function je(L) {
      return F(L) === i;
    }
    function nt(L) {
      return typeof L == "object" && L !== null && L.$$typeof === e;
    }
    function ft(L) {
      return F(L) === d;
    }
    function Be(L) {
      return F(L) === r;
    }
    function ze(L) {
      return F(L) === x;
    }
    function $e(L) {
      return F(L) === S;
    }
    function Te(L) {
      return F(L) === n;
    }
    function qe(L) {
      return F(L) === a;
    }
    function _e(L) {
      return F(L) === s;
    }
    function mt(L) {
      return F(L) === m;
    }
    ee.AsyncMode = D, ee.ConcurrentMode = R, ee.ContextConsumer = k, ee.ContextProvider = Y, ee.Element = ue, ee.ForwardRef = ne, ee.Fragment = G, ee.Lazy = ae, ee.Memo = q, ee.Portal = re, ee.Profiler = be, ee.StrictMode = Ne, ee.Suspense = dt, ee.isAsyncMode = tt, ee.isConcurrentMode = Qe, ee.isContextConsumer = Ue, ee.isContextProvider = je, ee.isElement = nt, ee.isForwardRef = ft, ee.isFragment = Be, ee.isLazy = ze, ee.isMemo = $e, ee.isPortal = Te, ee.isProfiler = qe, ee.isStrictMode = _e, ee.isSuspense = mt, ee.isValidElementType = j, ee.typeOf = F;
  }()), ee;
}
process.env.NODE_ENV === "production" ? ss.exports = Af() : ss.exports = jf();
var Tf = ss.exports, Qi = Tf, _f = {
  $$typeof: !0,
  render: !0,
  defaultProps: !0,
  displayName: !0,
  propTypes: !0
}, Rf = {
  $$typeof: !0,
  compare: !0,
  defaultProps: !0,
  displayName: !0,
  propTypes: !0,
  type: !0
}, Xi = {};
Xi[Qi.ForwardRef] = _f;
Xi[Qi.Memo] = Rf;
function le() {
  return le = Object.assign || function(t) {
    for (var e = 1; e < arguments.length; e++) {
      var n = arguments[e];
      for (var r in n)
        Object.prototype.hasOwnProperty.call(n, r) && (t[r] = n[r]);
    }
    return t;
  }, le.apply(this, arguments);
}
function sn(t, e) {
  if (t == null) return {};
  var n = {}, r = Object.keys(t), s, a;
  for (a = 0; a < r.length; a++)
    s = r[a], !(e.indexOf(s) >= 0) && (n[s] = t[s]);
  return n;
}
var Er = /* @__PURE__ */ bl(void 0);
Er.displayName = "FormikContext";
var Of = Er.Provider;
Er.Consumer;
function Zi() {
  var t = Nl(Er);
  return t || (process.env.NODE_ENV !== "production" ? we(!1, "Formik context is undefined, please verify you are calling useFormikContext() as child of a <Formik> component.") : we()), t;
}
var De = function(e) {
  return typeof e == "function";
}, Sr = function(e) {
  return e !== null && typeof e == "object";
}, Cf = function(e) {
  return String(Math.floor(Number(e))) === e;
}, zr = function(e) {
  return Object.prototype.toString.call(e) === "[object String]";
}, eo = function(e) {
  return yi.count(e) === 0;
}, qr = function(e) {
  return Sr(e) && De(e.then);
};
function Vf(t) {
  if (t = t || (typeof document < "u" ? document : void 0), typeof t > "u")
    return null;
  try {
    return t.activeElement || t.body;
  } catch {
    return t.body;
  }
}
function Me(t, e, n, r) {
  r === void 0 && (r = 0);
  for (var s = Ji(e); t && r < s.length; )
    t = t[s[r++]];
  return r !== s.length && !t || t === void 0 ? n : t;
}
function zt(t, e, n) {
  for (var r = Oa(t), s = r, a = 0, i = Ji(e); a < i.length - 1; a++) {
    var l = i[a], u = Me(t, i.slice(0, a + 1));
    if (u && (Sr(u) || Array.isArray(u)))
      s = s[l] = Oa(u);
    else {
      var f = i[a + 1];
      s = s[l] = Cf(f) && Number(f) >= 0 ? [] : {};
    }
  }
  return (a === 0 ? t : s)[i[a]] === n ? t : (n === void 0 ? delete s[i[a]] : s[i[a]] = n, a === 0 && n === void 0 && delete r[i[a]], r);
}
function to(t, e, n, r) {
  n === void 0 && (n = /* @__PURE__ */ new WeakMap()), r === void 0 && (r = {});
  for (var s = 0, a = Object.keys(t); s < a.length; s++) {
    var i = a[s], l = t[i];
    Sr(l) ? n.get(l) || (n.set(l, !0), r[i] = Array.isArray(l) ? [] : {}, to(l, e, n, r[i])) : r[i] = e;
  }
  return r;
}
function Ff(t, e) {
  switch (e.type) {
    case "SET_VALUES":
      return le({}, t, {
        values: e.payload
      });
    case "SET_TOUCHED":
      return le({}, t, {
        touched: e.payload
      });
    case "SET_ERRORS":
      return It(t.errors, e.payload) ? t : le({}, t, {
        errors: e.payload
      });
    case "SET_STATUS":
      return le({}, t, {
        status: e.payload
      });
    case "SET_ISSUBMITTING":
      return le({}, t, {
        isSubmitting: e.payload
      });
    case "SET_ISVALIDATING":
      return le({}, t, {
        isValidating: e.payload
      });
    case "SET_FIELD_VALUE":
      return le({}, t, {
        values: zt(t.values, e.payload.field, e.payload.value)
      });
    case "SET_FIELD_TOUCHED":
      return le({}, t, {
        touched: zt(t.touched, e.payload.field, e.payload.value)
      });
    case "SET_FIELD_ERROR":
      return le({}, t, {
        errors: zt(t.errors, e.payload.field, e.payload.value)
      });
    case "RESET_FORM":
      return le({}, t, e.payload);
    case "SET_FORMIK_STATE":
      return e.payload(t);
    case "SUBMIT_ATTEMPT":
      return le({}, t, {
        touched: to(t.values, !0),
        isSubmitting: !0,
        submitCount: t.submitCount + 1
      });
    case "SUBMIT_FAILURE":
      return le({}, t, {
        isSubmitting: !1
      });
    case "SUBMIT_SUCCESS":
      return le({}, t, {
        isSubmitting: !1
      });
    default:
      return t;
  }
}
var Pt = {}, sr = {};
function Pf(t) {
  var e = t.validateOnChange, n = e === void 0 ? !0 : e, r = t.validateOnBlur, s = r === void 0 ? !0 : r, a = t.validateOnMount, i = a === void 0 ? !1 : a, l = t.isInitialValid, u = t.enableReinitialize, f = u === void 0 ? !1 : u, d = t.onSubmit, m = sn(t, ["validateOnChange", "validateOnBlur", "validateOnMount", "isInitialValid", "enableReinitialize", "onSubmit"]), h = le({
    validateOnChange: n,
    validateOnBlur: s,
    validateOnMount: i,
    onSubmit: d
  }, m), S = yt(h.initialValues), x = yt(h.initialErrors || Pt), E = yt(h.initialTouched || sr), g = yt(h.initialStatus), v = yt(!1), b = yt({});
  process.env.NODE_ENV !== "production" && Ye(function() {
    typeof l > "u" || (process.env.NODE_ENV !== "production" ? we(!1, "isInitialValid has been deprecated and will be removed in future versions of Formik. Please use initialErrors or validateOnMount instead.") : we());
  }, []), Ye(function() {
    return v.current = !0, function() {
      v.current = !1;
    };
  }, []);
  var j = Ae(0), F = j[1], D = yt({
    values: rr(h.initialValues),
    errors: rr(h.initialErrors) || Pt,
    touched: rr(h.initialTouched) || sr,
    status: rr(h.initialStatus),
    isSubmitting: !1,
    isValidating: !1,
    submitCount: 0
  }), R = D.current, k = xe(function(N) {
    var V = D.current;
    D.current = Ff(V, N), V !== D.current && F(function($) {
      return $ + 1;
    });
  }, []), Y = xe(function(N, V) {
    return new Promise(function($, U) {
      var z = h.validate(N, V);
      z == null ? $(Pt) : qr(z) ? z.then(function(H) {
        $(H || Pt);
      }, function(H) {
        process.env.NODE_ENV !== "production" && console.warn("Warning: An unhandled error was caught during validation in <Formik validate />", H), U(H);
      }) : $(z);
    });
  }, [h.validate]), ue = xe(function(N, V) {
    var $ = h.validationSchema, U = De($) ? $(V) : $, z = V && U.validateAt ? U.validateAt(V, N) : kf(N, U);
    return new Promise(function(H, de) {
      z.then(function() {
        H(Pt);
      }, function(ve) {
        ve.name === "ValidationError" ? H($f(ve)) : (process.env.NODE_ENV !== "production" && console.warn("Warning: An unhandled error was caught during validation in <Formik validationSchema />", ve), de(ve));
      });
    });
  }, [h.validationSchema]), ne = xe(function(N, V) {
    return new Promise(function($) {
      return $(b.current[N].validate(V));
    });
  }, []), G = xe(function(N) {
    var V = Object.keys(b.current).filter(function(U) {
      return De(b.current[U].validate);
    }), $ = V.length > 0 ? V.map(function(U) {
      return ne(U, Me(N, U));
    }) : [Promise.resolve("DO_NOT_DELETE_YOU_WILL_BE_FIRED")];
    return Promise.all($).then(function(U) {
      return U.reduce(function(z, H, de) {
        return H === "DO_NOT_DELETE_YOU_WILL_BE_FIRED" || H && (z = zt(z, V[de], H)), z;
      }, {});
    });
  }, [ne]), ae = xe(function(N) {
    return Promise.all([G(N), h.validationSchema ? ue(N) : {}, h.validate ? Y(N) : {}]).then(function(V) {
      var $ = V[0], U = V[1], z = V[2], H = Xr.all([$, U, z], {
        arrayMerge: Lf
      });
      return H;
    });
  }, [h.validate, h.validationSchema, G, Y, ue]), q = We(function(N) {
    return N === void 0 && (N = R.values), k({
      type: "SET_ISVALIDATING",
      payload: !0
    }), ae(N).then(function(V) {
      return v.current && (k({
        type: "SET_ISVALIDATING",
        payload: !1
      }), k({
        type: "SET_ERRORS",
        payload: V
      })), V;
    });
  });
  Ye(function() {
    i && v.current === !0 && It(S.current, h.initialValues) && q(S.current);
  }, [i, q]);
  var re = xe(function(N) {
    var V = N && N.values ? N.values : S.current, $ = N && N.errors ? N.errors : x.current ? x.current : h.initialErrors || {}, U = N && N.touched ? N.touched : E.current ? E.current : h.initialTouched || {}, z = N && N.status ? N.status : g.current ? g.current : h.initialStatus;
    S.current = V, x.current = $, E.current = U, g.current = z;
    var H = function() {
      k({
        type: "RESET_FORM",
        payload: {
          isSubmitting: !!N && !!N.isSubmitting,
          errors: $,
          touched: U,
          status: z,
          values: V,
          isValidating: !!N && !!N.isValidating,
          submitCount: N && N.submitCount && typeof N.submitCount == "number" ? N.submitCount : 0
        }
      });
    };
    if (h.onReset) {
      var de = h.onReset(R.values, rt);
      qr(de) ? de.then(H) : H();
    } else
      H();
  }, [h.initialErrors, h.initialStatus, h.initialTouched, h.onReset]);
  Ye(function() {
    v.current === !0 && !It(S.current, h.initialValues) && f && (S.current = h.initialValues, re(), i && q(S.current));
  }, [f, h.initialValues, re, i, q]), Ye(function() {
    f && v.current === !0 && !It(x.current, h.initialErrors) && (x.current = h.initialErrors || Pt, k({
      type: "SET_ERRORS",
      payload: h.initialErrors || Pt
    }));
  }, [f, h.initialErrors]), Ye(function() {
    f && v.current === !0 && !It(E.current, h.initialTouched) && (E.current = h.initialTouched || sr, k({
      type: "SET_TOUCHED",
      payload: h.initialTouched || sr
    }));
  }, [f, h.initialTouched]), Ye(function() {
    f && v.current === !0 && !It(g.current, h.initialStatus) && (g.current = h.initialStatus, k({
      type: "SET_STATUS",
      payload: h.initialStatus
    }));
  }, [f, h.initialStatus, h.initialTouched]);
  var be = We(function(N) {
    if (b.current[N] && De(b.current[N].validate)) {
      var V = Me(R.values, N), $ = b.current[N].validate(V);
      return qr($) ? (k({
        type: "SET_ISVALIDATING",
        payload: !0
      }), $.then(function(U) {
        return U;
      }).then(function(U) {
        k({
          type: "SET_FIELD_ERROR",
          payload: {
            field: N,
            value: U
          }
        }), k({
          type: "SET_ISVALIDATING",
          payload: !1
        });
      })) : (k({
        type: "SET_FIELD_ERROR",
        payload: {
          field: N,
          value: $
        }
      }), Promise.resolve($));
    } else if (h.validationSchema)
      return k({
        type: "SET_ISVALIDATING",
        payload: !0
      }), ue(R.values, N).then(function(U) {
        return U;
      }).then(function(U) {
        k({
          type: "SET_FIELD_ERROR",
          payload: {
            field: N,
            value: Me(U, N)
          }
        }), k({
          type: "SET_ISVALIDATING",
          payload: !1
        });
      });
    return Promise.resolve();
  }), Ne = xe(function(N, V) {
    var $ = V.validate;
    b.current[N] = {
      validate: $
    };
  }, []), dt = xe(function(N) {
    delete b.current[N];
  }, []), Je = We(function(N, V) {
    k({
      type: "SET_TOUCHED",
      payload: N
    });
    var $ = V === void 0 ? s : V;
    return $ ? q(R.values) : Promise.resolve();
  }), tt = xe(function(N) {
    k({
      type: "SET_ERRORS",
      payload: N
    });
  }, []), Qe = We(function(N, V) {
    var $ = De(N) ? N(R.values) : N;
    k({
      type: "SET_VALUES",
      payload: $
    });
    var U = V === void 0 ? n : V;
    return U ? q($) : Promise.resolve();
  }), Ue = xe(function(N, V) {
    k({
      type: "SET_FIELD_ERROR",
      payload: {
        field: N,
        value: V
      }
    });
  }, []), je = We(function(N, V, $) {
    k({
      type: "SET_FIELD_VALUE",
      payload: {
        field: N,
        value: V
      }
    });
    var U = $ === void 0 ? n : $;
    return U ? q(zt(R.values, N, V)) : Promise.resolve();
  }), nt = xe(function(N, V) {
    var $ = V, U = N, z;
    if (!zr(N)) {
      N.persist && N.persist();
      var H = N.target ? N.target : N.currentTarget, de = H.type, ve = H.name, pt = H.id, ht = H.value, yn = H.checked, wn = H.outerHTML, en = H.options, En = H.multiple;
      $ = V || ve || pt, !$ && process.env.NODE_ENV !== "production" && Ia({
        htmlContent: wn,
        documentationAnchorLink: "handlechange-e-reactchangeeventany--void",
        handlerName: "handleChange"
      }), U = /number|range/.test(de) ? (z = parseFloat(ht), isNaN(z) ? "" : z) : /checkbox/.test(de) ? Uf(Me(R.values, $), yn, ht) : en && En ? Mf(en) : ht;
    }
    $ && je($, U);
  }, [je, R.values]), ft = We(function(N) {
    if (zr(N))
      return function(V) {
        return nt(V, N);
      };
    nt(N);
  }), Be = We(function(N, V, $) {
    V === void 0 && (V = !0), k({
      type: "SET_FIELD_TOUCHED",
      payload: {
        field: N,
        value: V
      }
    });
    var U = $ === void 0 ? s : $;
    return U ? q(R.values) : Promise.resolve();
  }), ze = xe(function(N, V) {
    N.persist && N.persist();
    var $ = N.target, U = $.name, z = $.id, H = $.outerHTML, de = V || U || z;
    !de && process.env.NODE_ENV !== "production" && Ia({
      htmlContent: H,
      documentationAnchorLink: "handleblur-e-any--void",
      handlerName: "handleBlur"
    }), Be(de, !0);
  }, [Be]), $e = We(function(N) {
    if (zr(N))
      return function(V) {
        return ze(V, N);
      };
    ze(N);
  }), Te = xe(function(N) {
    De(N) ? k({
      type: "SET_FORMIK_STATE",
      payload: N
    }) : k({
      type: "SET_FORMIK_STATE",
      payload: function() {
        return N;
      }
    });
  }, []), qe = xe(function(N) {
    k({
      type: "SET_STATUS",
      payload: N
    });
  }, []), _e = xe(function(N) {
    k({
      type: "SET_ISSUBMITTING",
      payload: N
    });
  }, []), mt = We(function() {
    return k({
      type: "SUBMIT_ATTEMPT"
    }), q().then(function(N) {
      var V = N instanceof Error, $ = !V && Object.keys(N).length === 0;
      if ($) {
        var U;
        try {
          if (U = st(), U === void 0)
            return;
        } catch (z) {
          throw z;
        }
        return Promise.resolve(U).then(function(z) {
          return v.current && k({
            type: "SUBMIT_SUCCESS"
          }), z;
        }).catch(function(z) {
          if (v.current)
            throw k({
              type: "SUBMIT_FAILURE"
            }), z;
        });
      } else if (v.current && (k({
        type: "SUBMIT_FAILURE"
      }), V))
        throw N;
    });
  }), L = We(function(N) {
    if (N && N.preventDefault && De(N.preventDefault) && N.preventDefault(), N && N.stopPropagation && De(N.stopPropagation) && N.stopPropagation(), process.env.NODE_ENV !== "production" && typeof document < "u") {
      var V = Vf();
      V !== null && V instanceof HTMLButtonElement && (V.attributes && V.attributes.getNamedItem("type") || (process.env.NODE_ENV !== "production" ? we(!1, 'You submitted a Formik form using a button with an unspecified `type` attribute.  Most browsers default button elements to `type="submit"`. If this is not a submit button, please add `type="button"`.') : we()));
    }
    mt().catch(function($) {
      console.warn("Warning: An unhandled error was caught from submitForm()", $);
    });
  }), rt = {
    resetForm: re,
    validateForm: q,
    validateField: be,
    setErrors: tt,
    setFieldError: Ue,
    setFieldTouched: Be,
    setFieldValue: je,
    setStatus: qe,
    setSubmitting: _e,
    setTouched: Je,
    setValues: Qe,
    setFormikState: Te,
    submitForm: mt
  }, st = We(function() {
    return d(R.values, rt);
  }), Re = We(function(N) {
    N && N.preventDefault && De(N.preventDefault) && N.preventDefault(), N && N.stopPropagation && De(N.stopPropagation) && N.stopPropagation(), re();
  }), ke = xe(function(N) {
    return {
      value: Me(R.values, N),
      error: Me(R.errors, N),
      touched: !!Me(R.touched, N),
      initialValue: Me(S.current, N),
      initialTouched: !!Me(E.current, N),
      initialError: Me(x.current, N)
    };
  }, [R.errors, R.touched, R.values]), Ct = xe(function(N) {
    return {
      setValue: function($, U) {
        return je(N, $, U);
      },
      setTouched: function($, U) {
        return Be(N, $, U);
      },
      setError: function($) {
        return Ue(N, $);
      }
    };
  }, [je, Be, Ue]), Vt = xe(function(N) {
    var V = Sr(N), $ = V ? N.name : N, U = Me(R.values, $), z = {
      name: $,
      value: U,
      onChange: ft,
      onBlur: $e
    };
    if (V) {
      var H = N.type, de = N.value, ve = N.as, pt = N.multiple;
      H === "checkbox" ? de === void 0 ? z.checked = !!U : (z.checked = !!(Array.isArray(U) && ~U.indexOf(de)), z.value = de) : H === "radio" ? (z.checked = U === de, z.value = de) : ve === "select" && pt && (z.value = z.value || [], z.multiple = !0);
    }
    return z;
  }, [$e, ft, R.values]), Le = ra(function() {
    return !It(S.current, R.values);
  }, [S.current, R.values]), Nn = ra(function() {
    return typeof l < "u" ? Le ? R.errors && Object.keys(R.errors).length === 0 : l !== !1 && De(l) ? l(h) : l : R.errors && Object.keys(R.errors).length === 0;
  }, [l, Le, R.errors, h]), vn = le({}, R, {
    initialValues: S.current,
    initialErrors: x.current,
    initialTouched: E.current,
    initialStatus: g.current,
    handleBlur: $e,
    handleChange: ft,
    handleReset: Re,
    handleSubmit: L,
    resetForm: re,
    setErrors: tt,
    setFormikState: Te,
    setFieldTouched: Be,
    setFieldValue: je,
    setFieldError: Ue,
    setStatus: qe,
    setSubmitting: _e,
    setTouched: Je,
    setValues: Qe,
    submitForm: mt,
    validateForm: q,
    validateField: be,
    isValid: Nn,
    dirty: Le,
    unregisterField: dt,
    registerField: Ne,
    getFieldProps: Vt,
    getFieldMeta: ke,
    getFieldHelpers: Ct,
    validateOnBlur: s,
    validateOnChange: n,
    validateOnMount: i
  });
  return vn;
}
function If(t) {
  var e = Pf(t), n = t.component, r = t.children, s = t.render, a = t.innerRef;
  return xl(a, function() {
    return e;
  }), process.env.NODE_ENV !== "production" && Ye(function() {
    t.render && (process.env.NODE_ENV !== "production" ? we(!1, "<Formik render> has been deprecated and will be removed in future versions of Formik. Please use a child callback function instead. To get rid of this warning, replace <Formik render={(props) => ...} /> with <Formik>{(props) => ...}</Formik>") : we());
  }, []), $t(Of, {
    value: e
  }, n ? $t(n, e) : s ? s(e) : r ? De(r) ? r(e) : eo(r) ? null : yi.only(r) : null);
}
function Ia(t) {
  var e = t.htmlContent, n = t.documentationAnchorLink, r = t.handlerName;
  console.warn("Warning: Formik called `" + r + "`, but you forgot to pass an `id` or `name` attribute to your input:\n    " + e + `
    Formik cannot determine which value to update. For more info see https://formik.org/docs/api/formik#` + n + `
  `);
}
function $f(t) {
  var e = {};
  if (t.inner) {
    if (t.inner.length === 0)
      return zt(e, t.path, t.message);
    for (var s = t.inner, n = Array.isArray(s), r = 0, s = n ? s : s[Symbol.iterator](); ; ) {
      var a;
      if (n) {
        if (r >= s.length) break;
        a = s[r++];
      } else {
        if (r = s.next(), r.done) break;
        a = r.value;
      }
      var i = a;
      Me(e, i.path) || (e = zt(e, i.path, i.message));
    }
  }
  return e;
}
function kf(t, e, n, r) {
  n === void 0 && (n = !1);
  var s = as(t);
  return e[n ? "validateSync" : "validate"](s, {
    abortEarly: !1,
    context: s
  });
}
function as(t) {
  var e = Array.isArray(t) ? [] : {};
  for (var n in t)
    if (Object.prototype.hasOwnProperty.call(t, n)) {
      var r = String(n);
      Array.isArray(t[r]) === !0 ? e[r] = t[r].map(function(s) {
        return Array.isArray(s) === !0 || oa(s) ? as(s) : s !== "" ? s : void 0;
      }) : oa(t[r]) ? e[r] = as(t[r]) : e[r] = t[r] !== "" ? t[r] : void 0;
    }
  return e;
}
function Lf(t, e, n) {
  var r = t.slice();
  return e.forEach(function(a, i) {
    if (typeof r[i] > "u") {
      var l = n.clone !== !1, u = l && n.isMergeableObject(a);
      r[i] = u ? Xr(Array.isArray(a) ? [] : {}, a, n) : a;
    } else n.isMergeableObject(a) ? r[i] = Xr(t[i], a, n) : t.indexOf(a) === -1 && r.push(a);
  }), r;
}
function Mf(t) {
  return Array.from(t).filter(function(e) {
    return e.selected;
  }).map(function(e) {
    return e.value;
  });
}
function Uf(t, e, n) {
  if (typeof t == "boolean")
    return !!e;
  var r = [], s = !1, a = -1;
  if (Array.isArray(t))
    r = t, a = t.indexOf(n), s = a >= 0;
  else if (!n || n == "true" || n == "false")
    return !!e;
  return e && n && !s ? r.concat(n) : s ? r.slice(0, a).concat(r.slice(a + 1)) : r;
}
var Bf = typeof window < "u" && typeof window.document < "u" && typeof window.document.createElement < "u" ? vl : Ye;
function We(t) {
  var e = yt(t);
  return Bf(function() {
    e.current = t;
  }), xe(function() {
    for (var n = arguments.length, r = new Array(n), s = 0; s < n; s++)
      r[s] = arguments[s];
    return e.current.apply(void 0, r);
  }, []);
}
function $a(t) {
  var e = t.validate, n = t.name, r = t.render, s = t.children, a = t.as, i = t.component, l = t.className, u = sn(t, ["validate", "name", "render", "children", "as", "component", "className"]), f = Zi(), d = sn(f, ["validate", "validationSchema"]);
  process.env.NODE_ENV !== "production" && Ye(function() {
    r && (process.env.NODE_ENV !== "production" ? we(!1, '<Field render> has been deprecated and will be removed in future versions of Formik. Please use a child callback function instead. To get rid of this warning, replace <Field name="' + n + '" render={({field, form}) => ...} /> with <Field name="' + n + '">{({field, form, meta}) => ...}</Field>') : we()), a && s && De(s) && (process.env.NODE_ENV !== "production" ? we(!1, "You should not use <Field as> and <Field children> as a function in the same <Field> component; <Field as> will be ignored.") : we()), i && s && De(s) && (process.env.NODE_ENV !== "production" ? we(!1, "You should not use <Field component> and <Field children> as a function in the same <Field> component; <Field component> will be ignored.") : we()), r && s && !eo(s) && (process.env.NODE_ENV !== "production" ? we(!1, "You should not use <Field render> and <Field children> in the same <Field> component; <Field children> will be ignored") : we());
  }, []);
  var m = d.registerField, h = d.unregisterField;
  Ye(function() {
    return m(n, {
      validate: e
    }), function() {
      h(n);
    };
  }, [m, h, n, e]);
  var S = d.getFieldProps(le({
    name: n
  }, u)), x = d.getFieldMeta(n), E = {
    field: S,
    form: d
  };
  if (r)
    return r(le({}, E, {
      meta: x
    }));
  if (De(s))
    return s(le({}, E, {
      meta: x
    }));
  if (i) {
    if (typeof i == "string") {
      var g = u.innerRef, v = sn(u, ["innerRef"]);
      return $t(i, le({
        ref: g
      }, S, v, {
        className: l
      }), s);
    }
    return $t(i, le({
      field: S,
      form: d
    }, u, {
      className: l
    }), s);
  }
  var b = a || "input";
  if (typeof b == "string") {
    var j = u.innerRef, F = sn(u, ["innerRef"]);
    return $t(b, le({
      ref: j
    }, S, F, {
      className: l
    }), s);
  }
  return $t(b, le({}, S, u, {
    className: l
  }), s);
}
var no = /* @__PURE__ */ gl(function(t, e) {
  var n = t.action, r = sn(t, ["action"]), s = n ?? "#", a = Zi(), i = a.handleReset, l = a.handleSubmit;
  return $t("form", le({
    onSubmit: l,
    ref: e,
    onReset: i,
    action: s
  }, r));
});
no.displayName = "Form";
function Xt(t) {
  this._maxSize = t, this.clear();
}
Xt.prototype.clear = function() {
  this._size = 0, this._values = /* @__PURE__ */ Object.create(null);
};
Xt.prototype.get = function(t) {
  return this._values[t];
};
Xt.prototype.set = function(t, e) {
  return this._size >= this._maxSize && this.clear(), t in this._values || this._size++, this._values[t] = e;
};
var zf = /[^.^\]^[]+|(?=\[\]|\.\.)/g, ro = /^\d+$/, qf = /^\d/, Wf = /[~`!#$%\^&*+=\-\[\]\\';,/{}|\\":<>\?]/g, Yf = /^\s*(['"]?)(.*?)(\1)\s*$/, Ms = 512, ka = new Xt(Ms), La = new Xt(Ms), Ma = new Xt(Ms), qt = {
  Cache: Xt,
  split: is,
  normalizePath: Wr,
  setter: function(t) {
    var e = Wr(t);
    return La.get(t) || La.set(t, function(r, s) {
      for (var a = 0, i = e.length, l = r; a < i - 1; ) {
        var u = e[a];
        if (u === "__proto__" || u === "constructor" || u === "prototype")
          return r;
        l = l[e[a++]];
      }
      l[e[a]] = s;
    });
  },
  getter: function(t, e) {
    var n = Wr(t);
    return Ma.get(t) || Ma.set(t, function(s) {
      for (var a = 0, i = n.length; a < i; )
        if (s != null || !e) s = s[n[a++]];
        else return;
      return s;
    });
  },
  join: function(t) {
    return t.reduce(function(e, n) {
      return e + (Us(n) || ro.test(n) ? "[" + n + "]" : (e ? "." : "") + n);
    }, "");
  },
  forEach: function(t, e, n) {
    Hf(Array.isArray(t) ? t : is(t), e, n);
  }
};
function Wr(t) {
  return ka.get(t) || ka.set(
    t,
    is(t).map(function(e) {
      return e.replace(Yf, "$2");
    })
  );
}
function is(t) {
  return t.match(zf) || [""];
}
function Hf(t, e, n) {
  var r = t.length, s, a, i, l;
  for (a = 0; a < r; a++)
    s = t[a], s && (Jf(s) && (s = '"' + s + '"'), l = Us(s), i = !l && /^\d+$/.test(s), e.call(n, s, l, i, a, t));
}
function Us(t) {
  return typeof t == "string" && t && ["'", '"'].indexOf(t.charAt(0)) !== -1;
}
function Gf(t) {
  return t.match(qf) && !t.match(ro);
}
function Kf(t) {
  return Wf.test(t);
}
function Jf(t) {
  return !Us(t) && (Gf(t) || Kf(t));
}
const Qf = /[A-Z\xc0-\xd6\xd8-\xde]?[a-z\xdf-\xf6\xf8-\xff]+(?:['’](?:d|ll|m|re|s|t|ve))?(?=[\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000]|[A-Z\xc0-\xd6\xd8-\xde]|$)|(?:[A-Z\xc0-\xd6\xd8-\xde]|[^\ud800-\udfff\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\d+\u2700-\u27bfa-z\xdf-\xf6\xf8-\xffA-Z\xc0-\xd6\xd8-\xde])+(?:['’](?:D|LL|M|RE|S|T|VE))?(?=[\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000]|[A-Z\xc0-\xd6\xd8-\xde](?:[a-z\xdf-\xf6\xf8-\xff]|[^\ud800-\udfff\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\d+\u2700-\u27bfa-z\xdf-\xf6\xf8-\xffA-Z\xc0-\xd6\xd8-\xde])|$)|[A-Z\xc0-\xd6\xd8-\xde]?(?:[a-z\xdf-\xf6\xf8-\xff]|[^\ud800-\udfff\xac\xb1\xd7\xf7\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\xbf\u2000-\u206f \t\x0b\f\xa0\ufeff\n\r\u2028\u2029\u1680\u180e\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\d+\u2700-\u27bfa-z\xdf-\xf6\xf8-\xffA-Z\xc0-\xd6\xd8-\xde])+(?:['’](?:d|ll|m|re|s|t|ve))?|[A-Z\xc0-\xd6\xd8-\xde]+(?:['’](?:D|LL|M|RE|S|T|VE))?|\d*(?:1ST|2ND|3RD|(?![123])\dTH)(?=\b|[a-z_])|\d*(?:1st|2nd|3rd|(?![123])\dth)(?=\b|[A-Z_])|\d+|(?:[\u2700-\u27bf]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff])[\ufe0e\ufe0f]?(?:[\u0300-\u036f\ufe20-\ufe2f\u20d0-\u20ff]|\ud83c[\udffb-\udfff])?(?:\u200d(?:[^\ud800-\udfff]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff])[\ufe0e\ufe0f]?(?:[\u0300-\u036f\ufe20-\ufe2f\u20d0-\u20ff]|\ud83c[\udffb-\udfff])?)*/g, Dr = (t) => t.match(Qf) || [], Ar = (t) => t[0].toUpperCase() + t.slice(1), Bs = (t, e) => Dr(t).join(e).toLowerCase(), so = (t) => Dr(t).reduce(
  (e, n) => `${e}${e ? n[0].toUpperCase() + n.slice(1).toLowerCase() : n.toLowerCase()}`,
  ""
), Xf = (t) => Ar(so(t)), Zf = (t) => Bs(t, "_"), em = (t) => Bs(t, "-"), tm = (t) => Ar(Bs(t, " ")), nm = (t) => Dr(t).map(Ar).join(" ");
var Yr = {
  words: Dr,
  upperFirst: Ar,
  camelCase: so,
  pascalCase: Xf,
  snakeCase: Zf,
  kebabCase: em,
  sentenceCase: tm,
  titleCase: nm
}, zs = { exports: {} };
zs.exports = function(t) {
  return ao(rm(t), t);
};
zs.exports.array = ao;
function ao(t, e) {
  var n = t.length, r = new Array(n), s = {}, a = n, i = sm(e), l = am(t);
  for (e.forEach(function(f) {
    if (!l.has(f[0]) || !l.has(f[1]))
      throw new Error("Unknown node. There is an unknown node in the supplied edges.");
  }); a--; )
    s[a] || u(t[a], a, /* @__PURE__ */ new Set());
  return r;
  function u(f, d, m) {
    if (m.has(f)) {
      var h;
      try {
        h = ", node was:" + JSON.stringify(f);
      } catch {
        h = "";
      }
      throw new Error("Cyclic dependency" + h);
    }
    if (!l.has(f))
      throw new Error("Found unknown node. Make sure to provided all involved nodes. Unknown node: " + JSON.stringify(f));
    if (!s[d]) {
      s[d] = !0;
      var S = i.get(f) || /* @__PURE__ */ new Set();
      if (S = Array.from(S), d = S.length) {
        m.add(f);
        do {
          var x = S[--d];
          u(x, l.get(x), m);
        } while (d);
        m.delete(f);
      }
      r[--n] = f;
    }
  }
}
function rm(t) {
  for (var e = /* @__PURE__ */ new Set(), n = 0, r = t.length; n < r; n++) {
    var s = t[n];
    e.add(s[0]), e.add(s[1]);
  }
  return Array.from(e);
}
function sm(t) {
  for (var e = /* @__PURE__ */ new Map(), n = 0, r = t.length; n < r; n++) {
    var s = t[n];
    e.has(s[0]) || e.set(s[0], /* @__PURE__ */ new Set()), e.has(s[1]) || e.set(s[1], /* @__PURE__ */ new Set()), e.get(s[0]).add(s[1]);
  }
  return e;
}
function am(t) {
  for (var e = /* @__PURE__ */ new Map(), n = 0, r = t.length; n < r; n++)
    e.set(t[n], n);
  return e;
}
var im = zs.exports;
const om = /* @__PURE__ */ Ei(im), lm = Object.prototype.toString, um = Error.prototype.toString, cm = RegExp.prototype.toString, dm = typeof Symbol < "u" ? Symbol.prototype.toString : () => "", fm = /^Symbol\((.*)\)(.*)$/;
function mm(t) {
  return t != +t ? "NaN" : t === 0 && 1 / t < 0 ? "-0" : "" + t;
}
function Ua(t, e = !1) {
  if (t == null || t === !0 || t === !1) return "" + t;
  const n = typeof t;
  if (n === "number") return mm(t);
  if (n === "string") return e ? `"${t}"` : t;
  if (n === "function") return "[Function " + (t.name || "anonymous") + "]";
  if (n === "symbol") return dm.call(t).replace(fm, "Symbol($1)");
  const r = lm.call(t).slice(8, -1);
  return r === "Date" ? isNaN(t.getTime()) ? "" + t : t.toISOString(t) : r === "Error" || t instanceof Error ? "[" + um.call(t) + "]" : r === "RegExp" ? cm.call(t) : null;
}
function _t(t, e) {
  let n = Ua(t, e);
  return n !== null ? n : JSON.stringify(t, function(r, s) {
    let a = Ua(this[r], e);
    return a !== null ? a : s;
  }, 2);
}
function io(t) {
  return t == null ? [] : [].concat(t);
}
let oo, lo, uo, pm = /\$\{\s*(\w+)\s*\}/g;
oo = Symbol.toStringTag;
class Ba {
  constructor(e, n, r, s) {
    this.name = void 0, this.message = void 0, this.value = void 0, this.path = void 0, this.type = void 0, this.params = void 0, this.errors = void 0, this.inner = void 0, this[oo] = "Error", this.name = "ValidationError", this.value = n, this.path = r, this.type = s, this.errors = [], this.inner = [], io(e).forEach((a) => {
      if (Fe.isError(a)) {
        this.errors.push(...a.errors);
        const i = a.inner.length ? a.inner : [a];
        this.inner.push(...i);
      } else
        this.errors.push(a);
    }), this.message = this.errors.length > 1 ? `${this.errors.length} errors occurred` : this.errors[0];
  }
}
lo = Symbol.hasInstance;
uo = Symbol.toStringTag;
class Fe extends Error {
  static formatError(e, n) {
    const r = n.label || n.path || "this";
    return n = Object.assign({}, n, {
      path: r,
      originalPath: n.path
    }), typeof e == "string" ? e.replace(pm, (s, a) => _t(n[a])) : typeof e == "function" ? e(n) : e;
  }
  static isError(e) {
    return e && e.name === "ValidationError";
  }
  constructor(e, n, r, s, a) {
    const i = new Ba(e, n, r, s);
    if (a)
      return i;
    super(), this.value = void 0, this.path = void 0, this.type = void 0, this.params = void 0, this.errors = [], this.inner = [], this[uo] = "Error", this.name = i.name, this.message = i.message, this.type = i.type, this.value = i.value, this.path = i.path, this.errors = i.errors, this.inner = i.inner, Error.captureStackTrace && Error.captureStackTrace(this, Fe);
  }
  static [lo](e) {
    return Ba[Symbol.hasInstance](e) || super[Symbol.hasInstance](e);
  }
}
let lt = {
  default: "${path} is invalid",
  required: "${path} is a required field",
  defined: "${path} must be defined",
  notNull: "${path} cannot be null",
  oneOf: "${path} must be one of the following values: ${values}",
  notOneOf: "${path} must not be one of the following values: ${values}",
  notType: ({
    path: t,
    type: e,
    value: n,
    originalValue: r
  }) => {
    const s = r != null && r !== n ? ` (cast from the value \`${_t(r, !0)}\`).` : ".";
    return e !== "mixed" ? `${t} must be a \`${e}\` type, but the final value was: \`${_t(n, !0)}\`` + s : `${t} must match the configured type. The validated value was: \`${_t(n, !0)}\`` + s;
  }
}, Ce = {
  length: "${path} must be exactly ${length} characters",
  min: "${path} must be at least ${min} characters",
  max: "${path} must be at most ${max} characters",
  matches: '${path} must match the following: "${regex}"',
  email: "${path} must be a valid email",
  url: "${path} must be a valid URL",
  uuid: "${path} must be a valid UUID",
  datetime: "${path} must be a valid ISO date-time",
  datetime_precision: "${path} must be a valid ISO date-time with a sub-second precision of exactly ${precision} digits",
  datetime_offset: '${path} must be a valid ISO date-time with UTC "Z" timezone',
  trim: "${path} must be a trimmed string",
  lowercase: "${path} must be a lowercase string",
  uppercase: "${path} must be a upper case string"
}, wt = {
  min: "${path} must be greater than or equal to ${min}",
  max: "${path} must be less than or equal to ${max}",
  lessThan: "${path} must be less than ${less}",
  moreThan: "${path} must be greater than ${more}",
  positive: "${path} must be a positive number",
  negative: "${path} must be a negative number",
  integer: "${path} must be an integer"
}, os = {
  min: "${path} field must be later than ${min}",
  max: "${path} field must be at earlier than ${max}"
}, ls = {
  isValue: "${path} field must be ${value}"
}, or = {
  noUnknown: "${path} field has unspecified keys: ${unknown}",
  exact: "${path} object contains unknown properties: ${properties}"
}, hm = {
  min: "${path} field must have at least ${min} items",
  max: "${path} field must have less than or equal to ${max} items",
  length: "${path} must have ${length} items"
}, gm = {
  notType: (t) => {
    const {
      path: e,
      value: n,
      spec: r
    } = t, s = r.types.length;
    if (Array.isArray(n)) {
      if (n.length < s) return `${e} tuple value has too few items, expected a length of ${s} but got ${n.length} for value: \`${_t(n, !0)}\``;
      if (n.length > s) return `${e} tuple value has too many items, expected a length of ${s} but got ${n.length} for value: \`${_t(n, !0)}\``;
    }
    return Fe.formatError(lt.notType, t);
  }
};
Object.assign(/* @__PURE__ */ Object.create(null), {
  mixed: lt,
  string: Ce,
  number: wt,
  date: os,
  object: or,
  array: hm,
  boolean: ls,
  tuple: gm
});
const qs = (t) => t && t.__isYupSchema__;
class mr {
  static fromOptions(e, n) {
    if (!n.then && !n.otherwise) throw new TypeError("either `then:` or `otherwise:` is required for `when()` conditions");
    let {
      is: r,
      then: s,
      otherwise: a
    } = n, i = typeof r == "function" ? r : (...l) => l.every((u) => u === r);
    return new mr(e, (l, u) => {
      var f;
      let d = i(...l) ? s : a;
      return (f = d == null ? void 0 : d(u)) != null ? f : u;
    });
  }
  constructor(e, n) {
    this.fn = void 0, this.refs = e, this.refs = e, this.fn = n;
  }
  resolve(e, n) {
    let r = this.refs.map((a) => (
      // TODO: ? operator here?
      a.getValue(n == null ? void 0 : n.value, n == null ? void 0 : n.parent, n == null ? void 0 : n.context)
    )), s = this.fn(r, e, n);
    if (s === void 0 || // @ts-ignore this can be base
    s === e)
      return e;
    if (!qs(s)) throw new TypeError("conditions must return a schema object");
    return s.resolve(n);
  }
}
const ar = {
  context: "$",
  value: "."
};
class Zt {
  constructor(e, n = {}) {
    if (this.key = void 0, this.isContext = void 0, this.isValue = void 0, this.isSibling = void 0, this.path = void 0, this.getter = void 0, this.map = void 0, typeof e != "string") throw new TypeError("ref must be a string, got: " + e);
    if (this.key = e.trim(), e === "") throw new TypeError("ref must be a non-empty string");
    this.isContext = this.key[0] === ar.context, this.isValue = this.key[0] === ar.value, this.isSibling = !this.isContext && !this.isValue;
    let r = this.isContext ? ar.context : this.isValue ? ar.value : "";
    this.path = this.key.slice(r.length), this.getter = this.path && qt.getter(this.path, !0), this.map = n.map;
  }
  getValue(e, n, r) {
    let s = this.isContext ? r : this.isValue ? e : n;
    return this.getter && (s = this.getter(s || {})), this.map && (s = this.map(s)), s;
  }
  /**
   *
   * @param {*} value
   * @param {Object} options
   * @param {Object=} options.context
   * @param {Object=} options.parent
   */
  cast(e, n) {
    return this.getValue(e, n == null ? void 0 : n.parent, n == null ? void 0 : n.context);
  }
  resolve() {
    return this;
  }
  describe() {
    return {
      type: "ref",
      key: this.key
    };
  }
  toString() {
    return `Ref(${this.key})`;
  }
  static isRef(e) {
    return e && e.__isYupRef;
  }
}
Zt.prototype.__isYupRef = !0;
const Ze = (t) => t == null;
function rn(t) {
  function e({
    value: n,
    path: r = "",
    options: s,
    originalValue: a,
    schema: i
  }, l, u) {
    const {
      name: f,
      test: d,
      params: m,
      message: h,
      skipAbsent: S
    } = t;
    let {
      parent: x,
      context: E,
      abortEarly: g = i.spec.abortEarly,
      disableStackTrace: v = i.spec.disableStackTrace
    } = s;
    function b(G) {
      return Zt.isRef(G) ? G.getValue(n, x, E) : G;
    }
    function j(G = {}) {
      const ae = Object.assign({
        value: n,
        originalValue: a,
        label: i.spec.label,
        path: G.path || r,
        spec: i.spec,
        disableStackTrace: G.disableStackTrace || v
      }, m, G.params);
      for (const re of Object.keys(ae)) ae[re] = b(ae[re]);
      const q = new Fe(Fe.formatError(G.message || h, ae), n, ae.path, G.type || f, ae.disableStackTrace);
      return q.params = ae, q;
    }
    const F = g ? l : u;
    let D = {
      path: r,
      parent: x,
      type: f,
      from: s.from,
      createError: j,
      resolve: b,
      options: s,
      originalValue: a,
      schema: i
    };
    const R = (G) => {
      Fe.isError(G) ? F(G) : G ? u(null) : F(j());
    }, k = (G) => {
      Fe.isError(G) ? F(G) : l(G);
    };
    if (S && Ze(n))
      return R(!0);
    let ue;
    try {
      var ne;
      if (ue = d.call(D, n, D), typeof ((ne = ue) == null ? void 0 : ne.then) == "function") {
        if (s.sync)
          throw new Error(`Validation test of type: "${D.type}" returned a Promise during a synchronous validate. This test will finish after the validate call has returned`);
        return Promise.resolve(ue).then(R, k);
      }
    } catch (G) {
      k(G);
      return;
    }
    R(ue);
  }
  return e.OPTIONS = t, e;
}
function xm(t, e, n, r = n) {
  let s, a, i;
  return e ? (qt.forEach(e, (l, u, f) => {
    let d = u ? l.slice(1, l.length - 1) : l;
    t = t.resolve({
      context: r,
      parent: s,
      value: n
    });
    let m = t.type === "tuple", h = f ? parseInt(d, 10) : 0;
    if (t.innerType || m) {
      if (m && !f) throw new Error(`Yup.reach cannot implicitly index into a tuple type. the path part "${i}" must contain an index to the tuple element, e.g. "${i}[0]"`);
      if (n && h >= n.length)
        throw new Error(`Yup.reach cannot resolve an array item at index: ${l}, in the path: ${e}. because there is no value at that index. `);
      s = n, n = n && n[h], t = m ? t.spec.types[h] : t.innerType;
    }
    if (!f) {
      if (!t.fields || !t.fields[d]) throw new Error(`The schema does not contain the path: ${e}. (failed at: ${i} which is a type: "${t.type}")`);
      s = n, n = n && n[d], t = t.fields[d];
    }
    a = d, i = u ? "[" + l + "]" : "." + l;
  }), {
    schema: t,
    parent: s,
    parentPath: a
  }) : {
    parent: s,
    parentPath: e,
    schema: t
  };
}
class pr extends Set {
  describe() {
    const e = [];
    for (const n of this.values())
      e.push(Zt.isRef(n) ? n.describe() : n);
    return e;
  }
  resolveAll(e) {
    let n = [];
    for (const r of this.values())
      n.push(e(r));
    return n;
  }
  clone() {
    return new pr(this.values());
  }
  merge(e, n) {
    const r = this.clone();
    return e.forEach((s) => r.add(s)), n.forEach((s) => r.delete(s)), r;
  }
}
function an(t, e = /* @__PURE__ */ new Map()) {
  if (qs(t) || !t || typeof t != "object") return t;
  if (e.has(t)) return e.get(t);
  let n;
  if (t instanceof Date)
    n = new Date(t.getTime()), e.set(t, n);
  else if (t instanceof RegExp)
    n = new RegExp(t), e.set(t, n);
  else if (Array.isArray(t)) {
    n = new Array(t.length), e.set(t, n);
    for (let r = 0; r < t.length; r++) n[r] = an(t[r], e);
  } else if (t instanceof Map) {
    n = /* @__PURE__ */ new Map(), e.set(t, n);
    for (const [r, s] of t.entries()) n.set(r, an(s, e));
  } else if (t instanceof Set) {
    n = /* @__PURE__ */ new Set(), e.set(t, n);
    for (const r of t) n.add(an(r, e));
  } else if (t instanceof Object) {
    n = {}, e.set(t, n);
    for (const [r, s] of Object.entries(t)) n[r] = an(s, e);
  } else
    throw Error(`Unable to clone ${t}`);
  return n;
}
class Ke {
  constructor(e) {
    this.type = void 0, this.deps = [], this.tests = void 0, this.transforms = void 0, this.conditions = [], this._mutate = void 0, this.internalTests = {}, this._whitelist = new pr(), this._blacklist = new pr(), this.exclusiveTests = /* @__PURE__ */ Object.create(null), this._typeCheck = void 0, this.spec = void 0, this.tests = [], this.transforms = [], this.withMutation(() => {
      this.typeError(lt.notType);
    }), this.type = e.type, this._typeCheck = e.check, this.spec = Object.assign({
      strip: !1,
      strict: !1,
      abortEarly: !0,
      recursive: !0,
      disableStackTrace: !1,
      nullable: !1,
      optional: !0,
      coerce: !0
    }, e == null ? void 0 : e.spec), this.withMutation((n) => {
      n.nonNullable();
    });
  }
  // TODO: remove
  get _type() {
    return this.type;
  }
  clone(e) {
    if (this._mutate)
      return e && Object.assign(this.spec, e), this;
    const n = Object.create(Object.getPrototypeOf(this));
    return n.type = this.type, n._typeCheck = this._typeCheck, n._whitelist = this._whitelist.clone(), n._blacklist = this._blacklist.clone(), n.internalTests = Object.assign({}, this.internalTests), n.exclusiveTests = Object.assign({}, this.exclusiveTests), n.deps = [...this.deps], n.conditions = [...this.conditions], n.tests = [...this.tests], n.transforms = [...this.transforms], n.spec = an(Object.assign({}, this.spec, e)), n;
  }
  label(e) {
    let n = this.clone();
    return n.spec.label = e, n;
  }
  meta(...e) {
    if (e.length === 0) return this.spec.meta;
    let n = this.clone();
    return n.spec.meta = Object.assign(n.spec.meta || {}, e[0]), n;
  }
  withMutation(e) {
    let n = this._mutate;
    this._mutate = !0;
    let r = e(this);
    return this._mutate = n, r;
  }
  concat(e) {
    if (!e || e === this) return this;
    if (e.type !== this.type && this.type !== "mixed") throw new TypeError(`You cannot \`concat()\` schema's of different types: ${this.type} and ${e.type}`);
    let n = this, r = e.clone();
    const s = Object.assign({}, n.spec, r.spec);
    return r.spec = s, r.internalTests = Object.assign({}, n.internalTests, r.internalTests), r._whitelist = n._whitelist.merge(e._whitelist, e._blacklist), r._blacklist = n._blacklist.merge(e._blacklist, e._whitelist), r.tests = n.tests, r.exclusiveTests = n.exclusiveTests, r.withMutation((a) => {
      e.tests.forEach((i) => {
        a.test(i.OPTIONS);
      });
    }), r.transforms = [...n.transforms, ...r.transforms], r;
  }
  isType(e) {
    return e == null ? !!(this.spec.nullable && e === null || this.spec.optional && e === void 0) : this._typeCheck(e);
  }
  resolve(e) {
    let n = this;
    if (n.conditions.length) {
      let r = n.conditions;
      n = n.clone(), n.conditions = [], n = r.reduce((s, a) => a.resolve(s, e), n), n = n.resolve(e);
    }
    return n;
  }
  resolveOptions(e) {
    var n, r, s, a;
    return Object.assign({}, e, {
      from: e.from || [],
      strict: (n = e.strict) != null ? n : this.spec.strict,
      abortEarly: (r = e.abortEarly) != null ? r : this.spec.abortEarly,
      recursive: (s = e.recursive) != null ? s : this.spec.recursive,
      disableStackTrace: (a = e.disableStackTrace) != null ? a : this.spec.disableStackTrace
    });
  }
  /**
   * Run the configured transform pipeline over an input value.
   */
  cast(e, n = {}) {
    let r = this.resolve(Object.assign({
      value: e
    }, n)), s = n.assert === "ignore-optionality", a = r._cast(e, n);
    if (n.assert !== !1 && !r.isType(a)) {
      if (s && Ze(a))
        return a;
      let i = _t(e), l = _t(a);
      throw new TypeError(`The value of ${n.path || "field"} could not be cast to a value that satisfies the schema type: "${r.type}". 

attempted value: ${i} 
` + (l !== i ? `result of cast: ${l}` : ""));
    }
    return a;
  }
  _cast(e, n) {
    let r = e === void 0 ? e : this.transforms.reduce((s, a) => a.call(this, s, e, this), e);
    return r === void 0 && (r = this.getDefault(n)), r;
  }
  _validate(e, n = {}, r, s) {
    let {
      path: a,
      originalValue: i = e,
      strict: l = this.spec.strict
    } = n, u = e;
    l || (u = this._cast(u, Object.assign({
      assert: !1
    }, n)));
    let f = [];
    for (let d of Object.values(this.internalTests))
      d && f.push(d);
    this.runTests({
      path: a,
      value: u,
      originalValue: i,
      options: n,
      tests: f
    }, r, (d) => {
      if (d.length)
        return s(d, u);
      this.runTests({
        path: a,
        value: u,
        originalValue: i,
        options: n,
        tests: this.tests
      }, r, s);
    });
  }
  /**
   * Executes a set of validations, either schema, produced Tests or a nested
   * schema validate result.
   */
  runTests(e, n, r) {
    let s = !1, {
      tests: a,
      value: i,
      originalValue: l,
      path: u,
      options: f
    } = e, d = (E) => {
      s || (s = !0, n(E, i));
    }, m = (E) => {
      s || (s = !0, r(E, i));
    }, h = a.length, S = [];
    if (!h) return m([]);
    let x = {
      value: i,
      originalValue: l,
      path: u,
      options: f,
      schema: this
    };
    for (let E = 0; E < a.length; E++) {
      const g = a[E];
      g(x, d, function(b) {
        b && (Array.isArray(b) ? S.push(...b) : S.push(b)), --h <= 0 && m(S);
      });
    }
  }
  asNestedTest({
    key: e,
    index: n,
    parent: r,
    parentPath: s,
    originalParent: a,
    options: i
  }) {
    const l = e ?? n;
    if (l == null)
      throw TypeError("Must include `key` or `index` for nested validations");
    const u = typeof l == "number";
    let f = r[l];
    const d = Object.assign({}, i, {
      // Nested validations fields are always strict:
      //    1. parent isn't strict so the casting will also have cast inner values
      //    2. parent is strict in which case the nested values weren't cast either
      strict: !0,
      parent: r,
      value: f,
      originalValue: a[l],
      // FIXME: tests depend on `index` being passed around deeply,
      //   we should not let the options.key/index bleed through
      key: void 0,
      // index: undefined,
      [u ? "index" : "key"]: l,
      path: u || l.includes(".") ? `${s || ""}[${u ? l : `"${l}"`}]` : (s ? `${s}.` : "") + e
    });
    return (m, h, S) => this.resolve(d)._validate(f, d, h, S);
  }
  validate(e, n) {
    var r;
    let s = this.resolve(Object.assign({}, n, {
      value: e
    })), a = (r = n == null ? void 0 : n.disableStackTrace) != null ? r : s.spec.disableStackTrace;
    return new Promise((i, l) => s._validate(e, n, (u, f) => {
      Fe.isError(u) && (u.value = f), l(u);
    }, (u, f) => {
      u.length ? l(new Fe(u, f, void 0, void 0, a)) : i(f);
    }));
  }
  validateSync(e, n) {
    var r;
    let s = this.resolve(Object.assign({}, n, {
      value: e
    })), a, i = (r = n == null ? void 0 : n.disableStackTrace) != null ? r : s.spec.disableStackTrace;
    return s._validate(e, Object.assign({}, n, {
      sync: !0
    }), (l, u) => {
      throw Fe.isError(l) && (l.value = u), l;
    }, (l, u) => {
      if (l.length) throw new Fe(l, e, void 0, void 0, i);
      a = u;
    }), a;
  }
  isValid(e, n) {
    return this.validate(e, n).then(() => !0, (r) => {
      if (Fe.isError(r)) return !1;
      throw r;
    });
  }
  isValidSync(e, n) {
    try {
      return this.validateSync(e, n), !0;
    } catch (r) {
      if (Fe.isError(r)) return !1;
      throw r;
    }
  }
  _getDefault(e) {
    let n = this.spec.default;
    return n == null ? n : typeof n == "function" ? n.call(this, e) : an(n);
  }
  getDefault(e) {
    return this.resolve(e || {})._getDefault(e);
  }
  default(e) {
    return arguments.length === 0 ? this._getDefault() : this.clone({
      default: e
    });
  }
  strict(e = !0) {
    return this.clone({
      strict: e
    });
  }
  nullability(e, n) {
    const r = this.clone({
      nullable: e
    });
    return r.internalTests.nullable = rn({
      message: n,
      name: "nullable",
      test(s) {
        return s === null ? this.schema.spec.nullable : !0;
      }
    }), r;
  }
  optionality(e, n) {
    const r = this.clone({
      optional: e
    });
    return r.internalTests.optionality = rn({
      message: n,
      name: "optionality",
      test(s) {
        return s === void 0 ? this.schema.spec.optional : !0;
      }
    }), r;
  }
  optional() {
    return this.optionality(!0);
  }
  defined(e = lt.defined) {
    return this.optionality(!1, e);
  }
  nullable() {
    return this.nullability(!0);
  }
  nonNullable(e = lt.notNull) {
    return this.nullability(!1, e);
  }
  required(e = lt.required) {
    return this.clone().withMutation((n) => n.nonNullable(e).defined(e));
  }
  notRequired() {
    return this.clone().withMutation((e) => e.nullable().optional());
  }
  transform(e) {
    let n = this.clone();
    return n.transforms.push(e), n;
  }
  /**
   * Adds a test function to the schema's queue of tests.
   * tests can be exclusive or non-exclusive.
   *
   * - exclusive tests, will replace any existing tests of the same name.
   * - non-exclusive: can be stacked
   *
   * If a non-exclusive test is added to a schema with an exclusive test of the same name
   * the exclusive test is removed and further tests of the same name will be stacked.
   *
   * If an exclusive test is added to a schema with non-exclusive tests of the same name
   * the previous tests are removed and further tests of the same name will replace each other.
   */
  test(...e) {
    let n;
    if (e.length === 1 ? typeof e[0] == "function" ? n = {
      test: e[0]
    } : n = e[0] : e.length === 2 ? n = {
      name: e[0],
      test: e[1]
    } : n = {
      name: e[0],
      message: e[1],
      test: e[2]
    }, n.message === void 0 && (n.message = lt.default), typeof n.test != "function") throw new TypeError("`test` is a required parameters");
    let r = this.clone(), s = rn(n), a = n.exclusive || n.name && r.exclusiveTests[n.name] === !0;
    if (n.exclusive && !n.name)
      throw new TypeError("Exclusive tests must provide a unique `name` identifying the test");
    return n.name && (r.exclusiveTests[n.name] = !!n.exclusive), r.tests = r.tests.filter((i) => !(i.OPTIONS.name === n.name && (a || i.OPTIONS.test === s.OPTIONS.test))), r.tests.push(s), r;
  }
  when(e, n) {
    !Array.isArray(e) && typeof e != "string" && (n = e, e = ".");
    let r = this.clone(), s = io(e).map((a) => new Zt(a));
    return s.forEach((a) => {
      a.isSibling && r.deps.push(a.key);
    }), r.conditions.push(typeof n == "function" ? new mr(s, n) : mr.fromOptions(s, n)), r;
  }
  typeError(e) {
    let n = this.clone();
    return n.internalTests.typeError = rn({
      message: e,
      name: "typeError",
      skipAbsent: !0,
      test(r) {
        return this.schema._typeCheck(r) ? !0 : this.createError({
          params: {
            type: this.schema.type
          }
        });
      }
    }), n;
  }
  oneOf(e, n = lt.oneOf) {
    let r = this.clone();
    return e.forEach((s) => {
      r._whitelist.add(s), r._blacklist.delete(s);
    }), r.internalTests.whiteList = rn({
      message: n,
      name: "oneOf",
      skipAbsent: !0,
      test(s) {
        let a = this.schema._whitelist, i = a.resolveAll(this.resolve);
        return i.includes(s) ? !0 : this.createError({
          params: {
            values: Array.from(a).join(", "),
            resolved: i
          }
        });
      }
    }), r;
  }
  notOneOf(e, n = lt.notOneOf) {
    let r = this.clone();
    return e.forEach((s) => {
      r._blacklist.add(s), r._whitelist.delete(s);
    }), r.internalTests.blacklist = rn({
      message: n,
      name: "notOneOf",
      test(s) {
        let a = this.schema._blacklist, i = a.resolveAll(this.resolve);
        return i.includes(s) ? this.createError({
          params: {
            values: Array.from(a).join(", "),
            resolved: i
          }
        }) : !0;
      }
    }), r;
  }
  strip(e = !0) {
    let n = this.clone();
    return n.spec.strip = e, n;
  }
  /**
   * Return a serialized description of the schema including validations, flags, types etc.
   *
   * @param options Provide any needed context for resolving runtime schema alterations (lazy, when conditions, etc).
   */
  describe(e) {
    const n = (e ? this.resolve(e) : this).clone(), {
      label: r,
      meta: s,
      optional: a,
      nullable: i
    } = n.spec;
    return {
      meta: s,
      label: r,
      optional: a,
      nullable: i,
      default: n.getDefault(e),
      type: n.type,
      oneOf: n._whitelist.describe(),
      notOneOf: n._blacklist.describe(),
      tests: n.tests.map((u) => ({
        name: u.OPTIONS.name,
        params: u.OPTIONS.params
      })).filter((u, f, d) => d.findIndex((m) => m.name === u.name) === f)
    };
  }
}
Ke.prototype.__isYupSchema__ = !0;
for (const t of ["validate", "validateSync"]) Ke.prototype[`${t}At`] = function(e, n, r = {}) {
  const {
    parent: s,
    parentPath: a,
    schema: i
  } = xm(this, e, n, r.context);
  return i[t](s && s[a], Object.assign({}, r, {
    parent: s,
    path: e
  }));
};
for (const t of ["equals", "is"]) Ke.prototype[t] = Ke.prototype.oneOf;
for (const t of ["not", "nope"]) Ke.prototype[t] = Ke.prototype.notOneOf;
function co() {
  return new fo();
}
class fo extends Ke {
  constructor() {
    super({
      type: "boolean",
      check(e) {
        return e instanceof Boolean && (e = e.valueOf()), typeof e == "boolean";
      }
    }), this.withMutation(() => {
      this.transform((e, n, r) => {
        if (r.spec.coerce && !r.isType(e)) {
          if (/^(true|1)$/i.test(String(e))) return !0;
          if (/^(false|0)$/i.test(String(e))) return !1;
        }
        return e;
      });
    });
  }
  isTrue(e = ls.isValue) {
    return this.test({
      message: e,
      name: "is-value",
      exclusive: !0,
      params: {
        value: "true"
      },
      test(n) {
        return Ze(n) || n === !0;
      }
    });
  }
  isFalse(e = ls.isValue) {
    return this.test({
      message: e,
      name: "is-value",
      exclusive: !0,
      params: {
        value: "false"
      },
      test(n) {
        return Ze(n) || n === !1;
      }
    });
  }
  default(e) {
    return super.default(e);
  }
  defined(e) {
    return super.defined(e);
  }
  optional() {
    return super.optional();
  }
  required(e) {
    return super.required(e);
  }
  notRequired() {
    return super.notRequired();
  }
  nullable() {
    return super.nullable();
  }
  nonNullable(e) {
    return super.nonNullable(e);
  }
  strip(e) {
    return super.strip(e);
  }
}
co.prototype = fo.prototype;
const bm = /^(\d{4}|[+-]\d{6})(?:-?(\d{2})(?:-?(\d{2}))?)?(?:[ T]?(\d{2}):?(\d{2})(?::?(\d{2})(?:[,.](\d{1,}))?)?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)?)?$/;
function Nm(t) {
  const e = us(t);
  if (!e) return Date.parse ? Date.parse(t) : Number.NaN;
  if (e.z === void 0 && e.plusMinus === void 0)
    return new Date(e.year, e.month, e.day, e.hour, e.minute, e.second, e.millisecond).valueOf();
  let n = 0;
  return e.z !== "Z" && e.plusMinus !== void 0 && (n = e.hourOffset * 60 + e.minuteOffset, e.plusMinus === "+" && (n = 0 - n)), Date.UTC(e.year, e.month, e.day, e.hour, e.minute + n, e.second, e.millisecond);
}
function us(t) {
  var e, n;
  const r = bm.exec(t);
  return r ? {
    year: xt(r[1]),
    month: xt(r[2], 1) - 1,
    day: xt(r[3], 1),
    hour: xt(r[4]),
    minute: xt(r[5]),
    second: xt(r[6]),
    millisecond: r[7] ? (
      // allow arbitrary sub-second precision beyond milliseconds
      xt(r[7].substring(0, 3))
    ) : 0,
    precision: (e = (n = r[7]) == null ? void 0 : n.length) != null ? e : void 0,
    z: r[8] || void 0,
    plusMinus: r[9] || void 0,
    hourOffset: xt(r[10]),
    minuteOffset: xt(r[11])
  } : null;
}
function xt(t, e = 0) {
  return Number(t) || e;
}
let vm = (
  // eslint-disable-next-line
  /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
), ym = (
  // eslint-disable-next-line
  /^((https?|ftp):)?\/\/(((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:)*@)?(((\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5])\.(\d|[1-9]\d|1\d\d|2[0-4]\d|25[0-5]))|((([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|\d|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.)+(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*([a-z]|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])))\.?)(:\d*)?)(\/((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)+(\/(([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)*)*)?)?(\?((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|[\uE000-\uF8FF]|\/|\?)*)?(\#((([a-z]|\d|-|\.|_|~|[\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])|(%[\da-f]{2})|[!\$&'\(\)\*\+,;=]|:|@)|\/|\?)*)?$/i
), wm = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i, Em = "^\\d{4}-\\d{2}-\\d{2}", Sm = "\\d{2}:\\d{2}:\\d{2}", Dm = "(([+-]\\d{2}(:?\\d{2})?)|Z)", Am = new RegExp(`${Em}T${Sm}(\\.\\d+)?${Dm}$`), jm = (t) => Ze(t) || t === t.trim(), Tm = {}.toString();
function cs() {
  return new mo();
}
class mo extends Ke {
  constructor() {
    super({
      type: "string",
      check(e) {
        return e instanceof String && (e = e.valueOf()), typeof e == "string";
      }
    }), this.withMutation(() => {
      this.transform((e, n, r) => {
        if (!r.spec.coerce || r.isType(e) || Array.isArray(e)) return e;
        const s = e != null && e.toString ? e.toString() : e;
        return s === Tm ? e : s;
      });
    });
  }
  required(e) {
    return super.required(e).withMutation((n) => n.test({
      message: e || lt.required,
      name: "required",
      skipAbsent: !0,
      test: (r) => !!r.length
    }));
  }
  notRequired() {
    return super.notRequired().withMutation((e) => (e.tests = e.tests.filter((n) => n.OPTIONS.name !== "required"), e));
  }
  length(e, n = Ce.length) {
    return this.test({
      message: n,
      name: "length",
      exclusive: !0,
      params: {
        length: e
      },
      skipAbsent: !0,
      test(r) {
        return r.length === this.resolve(e);
      }
    });
  }
  min(e, n = Ce.min) {
    return this.test({
      message: n,
      name: "min",
      exclusive: !0,
      params: {
        min: e
      },
      skipAbsent: !0,
      test(r) {
        return r.length >= this.resolve(e);
      }
    });
  }
  max(e, n = Ce.max) {
    return this.test({
      name: "max",
      exclusive: !0,
      message: n,
      params: {
        max: e
      },
      skipAbsent: !0,
      test(r) {
        return r.length <= this.resolve(e);
      }
    });
  }
  matches(e, n) {
    let r = !1, s, a;
    return n && (typeof n == "object" ? {
      excludeEmptyString: r = !1,
      message: s,
      name: a
    } = n : s = n), this.test({
      name: a || "matches",
      message: s || Ce.matches,
      params: {
        regex: e
      },
      skipAbsent: !0,
      test: (i) => i === "" && r || i.search(e) !== -1
    });
  }
  email(e = Ce.email) {
    return this.matches(vm, {
      name: "email",
      message: e,
      excludeEmptyString: !0
    });
  }
  url(e = Ce.url) {
    return this.matches(ym, {
      name: "url",
      message: e,
      excludeEmptyString: !0
    });
  }
  uuid(e = Ce.uuid) {
    return this.matches(wm, {
      name: "uuid",
      message: e,
      excludeEmptyString: !1
    });
  }
  datetime(e) {
    let n = "", r, s;
    return e && (typeof e == "object" ? {
      message: n = "",
      allowOffset: r = !1,
      precision: s = void 0
    } = e : n = e), this.matches(Am, {
      name: "datetime",
      message: n || Ce.datetime,
      excludeEmptyString: !0
    }).test({
      name: "datetime_offset",
      message: n || Ce.datetime_offset,
      params: {
        allowOffset: r
      },
      skipAbsent: !0,
      test: (a) => {
        if (!a || r) return !0;
        const i = us(a);
        return i ? !!i.z : !1;
      }
    }).test({
      name: "datetime_precision",
      message: n || Ce.datetime_precision,
      params: {
        precision: s
      },
      skipAbsent: !0,
      test: (a) => {
        if (!a || s == null) return !0;
        const i = us(a);
        return i ? i.precision === s : !1;
      }
    });
  }
  //-- transforms --
  ensure() {
    return this.default("").transform((e) => e === null ? "" : e);
  }
  trim(e = Ce.trim) {
    return this.transform((n) => n != null ? n.trim() : n).test({
      message: e,
      name: "trim",
      test: jm
    });
  }
  lowercase(e = Ce.lowercase) {
    return this.transform((n) => Ze(n) ? n : n.toLowerCase()).test({
      message: e,
      name: "string_case",
      exclusive: !0,
      skipAbsent: !0,
      test: (n) => Ze(n) || n === n.toLowerCase()
    });
  }
  uppercase(e = Ce.uppercase) {
    return this.transform((n) => Ze(n) ? n : n.toUpperCase()).test({
      message: e,
      name: "string_case",
      exclusive: !0,
      skipAbsent: !0,
      test: (n) => Ze(n) || n === n.toUpperCase()
    });
  }
}
cs.prototype = mo.prototype;
let _m = (t) => t != +t;
function po() {
  return new ho();
}
class ho extends Ke {
  constructor() {
    super({
      type: "number",
      check(e) {
        return e instanceof Number && (e = e.valueOf()), typeof e == "number" && !_m(e);
      }
    }), this.withMutation(() => {
      this.transform((e, n, r) => {
        if (!r.spec.coerce) return e;
        let s = e;
        if (typeof s == "string") {
          if (s = s.replace(/\s/g, ""), s === "") return NaN;
          s = +s;
        }
        return r.isType(s) || s === null ? s : parseFloat(s);
      });
    });
  }
  min(e, n = wt.min) {
    return this.test({
      message: n,
      name: "min",
      exclusive: !0,
      params: {
        min: e
      },
      skipAbsent: !0,
      test(r) {
        return r >= this.resolve(e);
      }
    });
  }
  max(e, n = wt.max) {
    return this.test({
      message: n,
      name: "max",
      exclusive: !0,
      params: {
        max: e
      },
      skipAbsent: !0,
      test(r) {
        return r <= this.resolve(e);
      }
    });
  }
  lessThan(e, n = wt.lessThan) {
    return this.test({
      message: n,
      name: "max",
      exclusive: !0,
      params: {
        less: e
      },
      skipAbsent: !0,
      test(r) {
        return r < this.resolve(e);
      }
    });
  }
  moreThan(e, n = wt.moreThan) {
    return this.test({
      message: n,
      name: "min",
      exclusive: !0,
      params: {
        more: e
      },
      skipAbsent: !0,
      test(r) {
        return r > this.resolve(e);
      }
    });
  }
  positive(e = wt.positive) {
    return this.moreThan(0, e);
  }
  negative(e = wt.negative) {
    return this.lessThan(0, e);
  }
  integer(e = wt.integer) {
    return this.test({
      name: "integer",
      message: e,
      skipAbsent: !0,
      test: (n) => Number.isInteger(n)
    });
  }
  truncate() {
    return this.transform((e) => Ze(e) ? e : e | 0);
  }
  round(e) {
    var n;
    let r = ["ceil", "floor", "round", "trunc"];
    if (e = ((n = e) == null ? void 0 : n.toLowerCase()) || "round", e === "trunc") return this.truncate();
    if (r.indexOf(e.toLowerCase()) === -1) throw new TypeError("Only valid options for round() are: " + r.join(", "));
    return this.transform((s) => Ze(s) ? s : Math[e](s));
  }
}
po.prototype = ho.prototype;
let Rm = /* @__PURE__ */ new Date(""), Om = (t) => Object.prototype.toString.call(t) === "[object Date]";
class Ws extends Ke {
  constructor() {
    super({
      type: "date",
      check(e) {
        return Om(e) && !isNaN(e.getTime());
      }
    }), this.withMutation(() => {
      this.transform((e, n, r) => !r.spec.coerce || r.isType(e) || e === null ? e : (e = Nm(e), isNaN(e) ? Ws.INVALID_DATE : new Date(e)));
    });
  }
  prepareParam(e, n) {
    let r;
    if (Zt.isRef(e))
      r = e;
    else {
      let s = this.cast(e);
      if (!this._typeCheck(s)) throw new TypeError(`\`${n}\` must be a Date or a value that can be \`cast()\` to a Date`);
      r = s;
    }
    return r;
  }
  min(e, n = os.min) {
    let r = this.prepareParam(e, "min");
    return this.test({
      message: n,
      name: "min",
      exclusive: !0,
      params: {
        min: e
      },
      skipAbsent: !0,
      test(s) {
        return s >= this.resolve(r);
      }
    });
  }
  max(e, n = os.max) {
    let r = this.prepareParam(e, "max");
    return this.test({
      message: n,
      name: "max",
      exclusive: !0,
      params: {
        max: e
      },
      skipAbsent: !0,
      test(s) {
        return s <= this.resolve(r);
      }
    });
  }
}
Ws.INVALID_DATE = Rm;
function Cm(t, e = []) {
  let n = [], r = /* @__PURE__ */ new Set(), s = new Set(e.map(([i, l]) => `${i}-${l}`));
  function a(i, l) {
    let u = qt.split(i)[0];
    r.add(u), s.has(`${l}-${u}`) || n.push([l, u]);
  }
  for (const i of Object.keys(t)) {
    let l = t[i];
    r.add(i), Zt.isRef(l) && l.isSibling ? a(l.path, i) : qs(l) && "deps" in l && l.deps.forEach((u) => a(u, i));
  }
  return om.array(Array.from(r), n).reverse();
}
function za(t, e) {
  let n = 1 / 0;
  return t.some((r, s) => {
    var a;
    if ((a = e.path) != null && a.includes(r))
      return n = s, !0;
  }), n;
}
function go(t) {
  return (e, n) => za(t, e) - za(t, n);
}
const Vm = (t, e, n) => {
  if (typeof t != "string")
    return t;
  let r = t;
  try {
    r = JSON.parse(t);
  } catch {
  }
  return n.isType(r) ? r : t;
};
function lr(t) {
  if ("fields" in t) {
    const e = {};
    for (const [n, r] of Object.entries(t.fields))
      e[n] = lr(r);
    return t.setFields(e);
  }
  if (t.type === "array") {
    const e = t.optional();
    return e.innerType && (e.innerType = lr(e.innerType)), e;
  }
  return t.type === "tuple" ? t.optional().clone({
    types: t.spec.types.map(lr)
  }) : "optional" in t ? t.optional() : t;
}
const Fm = (t, e) => {
  const n = [...qt.normalizePath(e)];
  if (n.length === 1) return n[0] in t;
  let r = n.pop(), s = qt.getter(qt.join(n), !0)(t);
  return !!(s && r in s);
};
let qa = (t) => Object.prototype.toString.call(t) === "[object Object]";
function Wa(t, e) {
  let n = Object.keys(t.fields);
  return Object.keys(e).filter((r) => n.indexOf(r) === -1);
}
const Pm = go([]);
function xo(t) {
  return new bo(t);
}
class bo extends Ke {
  constructor(e) {
    super({
      type: "object",
      check(n) {
        return qa(n) || typeof n == "function";
      }
    }), this.fields = /* @__PURE__ */ Object.create(null), this._sortErrors = Pm, this._nodes = [], this._excludedEdges = [], this.withMutation(() => {
      e && this.shape(e);
    });
  }
  _cast(e, n = {}) {
    var r;
    let s = super._cast(e, n);
    if (s === void 0) return this.getDefault(n);
    if (!this._typeCheck(s)) return s;
    let a = this.fields, i = (r = n.stripUnknown) != null ? r : this.spec.noUnknown, l = [].concat(this._nodes, Object.keys(s).filter((m) => !this._nodes.includes(m))), u = {}, f = Object.assign({}, n, {
      parent: u,
      __validating: n.__validating || !1
    }), d = !1;
    for (const m of l) {
      let h = a[m], S = m in s;
      if (h) {
        let x, E = s[m];
        f.path = (n.path ? `${n.path}.` : "") + m, h = h.resolve({
          value: E,
          context: n.context,
          parent: u
        });
        let g = h instanceof Ke ? h.spec : void 0, v = g == null ? void 0 : g.strict;
        if (g != null && g.strip) {
          d = d || m in s;
          continue;
        }
        x = !n.__validating || !v ? (
          // TODO: use _cast, this is double resolving
          h.cast(s[m], f)
        ) : s[m], x !== void 0 && (u[m] = x);
      } else S && !i && (u[m] = s[m]);
      (S !== m in u || u[m] !== s[m]) && (d = !0);
    }
    return d ? u : s;
  }
  _validate(e, n = {}, r, s) {
    let {
      from: a = [],
      originalValue: i = e,
      recursive: l = this.spec.recursive
    } = n;
    n.from = [{
      schema: this,
      value: i
    }, ...a], n.__validating = !0, n.originalValue = i, super._validate(e, n, r, (u, f) => {
      if (!l || !qa(f)) {
        s(u, f);
        return;
      }
      i = i || f;
      let d = [];
      for (let m of this._nodes) {
        let h = this.fields[m];
        !h || Zt.isRef(h) || d.push(h.asNestedTest({
          options: n,
          key: m,
          parent: f,
          parentPath: n.path,
          originalParent: i
        }));
      }
      this.runTests({
        tests: d,
        value: f,
        originalValue: i,
        options: n
      }, r, (m) => {
        s(m.sort(this._sortErrors).concat(u), f);
      });
    });
  }
  clone(e) {
    const n = super.clone(e);
    return n.fields = Object.assign({}, this.fields), n._nodes = this._nodes, n._excludedEdges = this._excludedEdges, n._sortErrors = this._sortErrors, n;
  }
  concat(e) {
    let n = super.concat(e), r = n.fields;
    for (let [s, a] of Object.entries(this.fields)) {
      const i = r[s];
      r[s] = i === void 0 ? a : i;
    }
    return n.withMutation((s) => (
      // XXX: excludes here is wrong
      s.setFields(r, [...this._excludedEdges, ...e._excludedEdges])
    ));
  }
  _getDefault(e) {
    if ("default" in this.spec)
      return super._getDefault(e);
    if (!this._nodes.length)
      return;
    let n = {};
    return this._nodes.forEach((r) => {
      var s;
      const a = this.fields[r];
      let i = e;
      (s = i) != null && s.value && (i = Object.assign({}, i, {
        parent: i.value,
        value: i.value[r]
      })), n[r] = a && "getDefault" in a ? a.getDefault(i) : void 0;
    }), n;
  }
  setFields(e, n) {
    let r = this.clone();
    return r.fields = e, r._nodes = Cm(e, n), r._sortErrors = go(Object.keys(e)), n && (r._excludedEdges = n), r;
  }
  shape(e, n = []) {
    return this.clone().withMutation((r) => {
      let s = r._excludedEdges;
      return n.length && (Array.isArray(n[0]) || (n = [n]), s = [...r._excludedEdges, ...n]), r.setFields(Object.assign(r.fields, e), s);
    });
  }
  partial() {
    const e = {};
    for (const [n, r] of Object.entries(this.fields))
      e[n] = "optional" in r && r.optional instanceof Function ? r.optional() : r;
    return this.setFields(e);
  }
  deepPartial() {
    return lr(this);
  }
  pick(e) {
    const n = {};
    for (const r of e)
      this.fields[r] && (n[r] = this.fields[r]);
    return this.setFields(n, this._excludedEdges.filter(([r, s]) => e.includes(r) && e.includes(s)));
  }
  omit(e) {
    const n = [];
    for (const r of Object.keys(this.fields))
      e.includes(r) || n.push(r);
    return this.pick(n);
  }
  from(e, n, r) {
    let s = qt.getter(e, !0);
    return this.transform((a) => {
      if (!a) return a;
      let i = a;
      return Fm(a, e) && (i = Object.assign({}, a), r || delete i[e], i[n] = s(a)), i;
    });
  }
  /** Parse an input JSON string to an object */
  json() {
    return this.transform(Vm);
  }
  /**
   * Similar to `noUnknown` but only validates that an object is the right shape without stripping the unknown keys
   */
  exact(e) {
    return this.test({
      name: "exact",
      exclusive: !0,
      message: e || or.exact,
      test(n) {
        if (n == null) return !0;
        const r = Wa(this.schema, n);
        return r.length === 0 || this.createError({
          params: {
            properties: r.join(", ")
          }
        });
      }
    });
  }
  stripUnknown() {
    return this.clone({
      noUnknown: !0
    });
  }
  noUnknown(e = !0, n = or.noUnknown) {
    typeof e != "boolean" && (n = e, e = !0);
    let r = this.test({
      name: "noUnknown",
      exclusive: !0,
      message: n,
      test(s) {
        if (s == null) return !0;
        const a = Wa(this.schema, s);
        return !e || a.length === 0 || this.createError({
          params: {
            unknown: a.join(", ")
          }
        });
      }
    });
    return r.spec.noUnknown = e, r;
  }
  unknown(e = !0, n = or.noUnknown) {
    return this.noUnknown(!e, n);
  }
  transformKeys(e) {
    return this.transform((n) => {
      if (!n) return n;
      const r = {};
      for (const s of Object.keys(n)) r[e(s)] = n[s];
      return r;
    });
  }
  camelCase() {
    return this.transformKeys(Yr.camelCase);
  }
  snakeCase() {
    return this.transformKeys(Yr.snakeCase);
  }
  constantCase() {
    return this.transformKeys((e) => Yr.snakeCase(e).toUpperCase());
  }
  describe(e) {
    const n = (e ? this.resolve(e) : this).clone(), r = super.describe(e);
    r.fields = {};
    for (const [a, i] of Object.entries(n.fields)) {
      var s;
      let l = e;
      (s = l) != null && s.value && (l = Object.assign({}, l, {
        parent: l.value,
        value: l.value[a]
      })), r.fields[a] = i.describe(l);
    }
    return r;
  }
}
xo.prototype = bo.prototype;
function Nt(t, e, { checkForDefaultPrevented: n = !0 } = {}) {
  return function(s) {
    if (t == null || t(s), n === !1 || !s.defaultPrevented)
      return e == null ? void 0 : e(s);
  };
}
var ds = { exports: {} }, _n = {};
/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Ya;
function Im() {
  if (Ya) return _n;
  Ya = 1;
  var t = ot, e = Symbol.for("react.element"), n = Symbol.for("react.fragment"), r = Object.prototype.hasOwnProperty, s = t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner, a = { key: !0, ref: !0, __self: !0, __source: !0 };
  function i(l, u, f) {
    var d, m = {}, h = null, S = null;
    f !== void 0 && (h = "" + f), u.key !== void 0 && (h = "" + u.key), u.ref !== void 0 && (S = u.ref);
    for (d in u) r.call(u, d) && !a.hasOwnProperty(d) && (m[d] = u[d]);
    if (l && l.defaultProps) for (d in u = l.defaultProps, u) m[d] === void 0 && (m[d] = u[d]);
    return { $$typeof: e, type: l, key: h, ref: S, props: m, _owner: s.current };
  }
  return _n.Fragment = n, _n.jsx = i, _n.jsxs = i, _n;
}
var Rn = {};
/**
 * @license React
 * react-jsx-runtime.development.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var Ha;
function $m() {
  return Ha || (Ha = 1, process.env.NODE_ENV !== "production" && function() {
    var t = ot, e = Symbol.for("react.element"), n = Symbol.for("react.portal"), r = Symbol.for("react.fragment"), s = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), i = Symbol.for("react.provider"), l = Symbol.for("react.context"), u = Symbol.for("react.forward_ref"), f = Symbol.for("react.suspense"), d = Symbol.for("react.suspense_list"), m = Symbol.for("react.memo"), h = Symbol.for("react.lazy"), S = Symbol.for("react.offscreen"), x = Symbol.iterator, E = "@@iterator";
    function g(c) {
      if (c === null || typeof c != "object")
        return null;
      var y = x && c[x] || c[E];
      return typeof y == "function" ? y : null;
    }
    var v = t.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    function b(c) {
      {
        for (var y = arguments.length, A = new Array(y > 1 ? y - 1 : 0), C = 1; C < y; C++)
          A[C - 1] = arguments[C];
        j("error", c, A);
      }
    }
    function j(c, y, A) {
      {
        var C = v.ReactDebugCurrentFrame, P = C.getStackAddendum();
        P !== "" && (y += "%s", A = A.concat([P]));
        var I = A.map(function(B) {
          return String(B);
        });
        I.unshift("Warning: " + y), Function.prototype.apply.call(console[c], console, I);
      }
    }
    var F = !1, D = !1, R = !1, k = !1, Y = !1, ue;
    ue = Symbol.for("react.module.reference");
    function ne(c) {
      return !!(typeof c == "string" || typeof c == "function" || c === r || c === a || Y || c === s || c === f || c === d || k || c === S || F || D || R || typeof c == "object" && c !== null && (c.$$typeof === h || c.$$typeof === m || c.$$typeof === i || c.$$typeof === l || c.$$typeof === u || // This needs to include all possible module reference object
      // types supported by any Flight configuration anywhere since
      // we don't know which Flight build this will end up being used
      // with.
      c.$$typeof === ue || c.getModuleId !== void 0));
    }
    function G(c, y, A) {
      var C = c.displayName;
      if (C)
        return C;
      var P = y.displayName || y.name || "";
      return P !== "" ? A + "(" + P + ")" : A;
    }
    function ae(c) {
      return c.displayName || "Context";
    }
    function q(c) {
      if (c == null)
        return null;
      if (typeof c.tag == "number" && b("Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."), typeof c == "function")
        return c.displayName || c.name || null;
      if (typeof c == "string")
        return c;
      switch (c) {
        case r:
          return "Fragment";
        case n:
          return "Portal";
        case a:
          return "Profiler";
        case s:
          return "StrictMode";
        case f:
          return "Suspense";
        case d:
          return "SuspenseList";
      }
      if (typeof c == "object")
        switch (c.$$typeof) {
          case l:
            var y = c;
            return ae(y) + ".Consumer";
          case i:
            var A = c;
            return ae(A._context) + ".Provider";
          case u:
            return G(c, c.render, "ForwardRef");
          case m:
            var C = c.displayName || null;
            return C !== null ? C : q(c.type) || "Memo";
          case h: {
            var P = c, I = P._payload, B = P._init;
            try {
              return q(B(I));
            } catch {
              return null;
            }
          }
        }
      return null;
    }
    var re = Object.assign, be = 0, Ne, dt, Je, tt, Qe, Ue, je;
    function nt() {
    }
    nt.__reactDisabledLog = !0;
    function ft() {
      {
        if (be === 0) {
          Ne = console.log, dt = console.info, Je = console.warn, tt = console.error, Qe = console.group, Ue = console.groupCollapsed, je = console.groupEnd;
          var c = {
            configurable: !0,
            enumerable: !0,
            value: nt,
            writable: !0
          };
          Object.defineProperties(console, {
            info: c,
            log: c,
            warn: c,
            error: c,
            group: c,
            groupCollapsed: c,
            groupEnd: c
          });
        }
        be++;
      }
    }
    function Be() {
      {
        if (be--, be === 0) {
          var c = {
            configurable: !0,
            enumerable: !0,
            writable: !0
          };
          Object.defineProperties(console, {
            log: re({}, c, {
              value: Ne
            }),
            info: re({}, c, {
              value: dt
            }),
            warn: re({}, c, {
              value: Je
            }),
            error: re({}, c, {
              value: tt
            }),
            group: re({}, c, {
              value: Qe
            }),
            groupCollapsed: re({}, c, {
              value: Ue
            }),
            groupEnd: re({}, c, {
              value: je
            })
          });
        }
        be < 0 && b("disabledDepth fell below zero. This is a bug in React. Please file an issue.");
      }
    }
    var ze = v.ReactCurrentDispatcher, $e;
    function Te(c, y, A) {
      {
        if ($e === void 0)
          try {
            throw Error();
          } catch (P) {
            var C = P.stack.trim().match(/\n( *(at )?)/);
            $e = C && C[1] || "";
          }
        return `
` + $e + c;
      }
    }
    var qe = !1, _e;
    {
      var mt = typeof WeakMap == "function" ? WeakMap : Map;
      _e = new mt();
    }
    function L(c, y) {
      if (!c || qe)
        return "";
      {
        var A = _e.get(c);
        if (A !== void 0)
          return A;
      }
      var C;
      qe = !0;
      var P = Error.prepareStackTrace;
      Error.prepareStackTrace = void 0;
      var I;
      I = ze.current, ze.current = null, ft();
      try {
        if (y) {
          var B = function() {
            throw Error();
          };
          if (Object.defineProperty(B.prototype, "props", {
            set: function() {
              throw Error();
            }
          }), typeof Reflect == "object" && Reflect.construct) {
            try {
              Reflect.construct(B, []);
            } catch (ye) {
              C = ye;
            }
            Reflect.construct(c, [], B);
          } else {
            try {
              B.call();
            } catch (ye) {
              C = ye;
            }
            c.call(B.prototype);
          }
        } else {
          try {
            throw Error();
          } catch (ye) {
            C = ye;
          }
          c();
        }
      } catch (ye) {
        if (ye && C && typeof ye.stack == "string") {
          for (var M = ye.stack.split(`
`), K = C.stack.split(`
`), Q = M.length - 1, se = K.length - 1; Q >= 1 && se >= 0 && M[Q] !== K[se]; )
            se--;
          for (; Q >= 1 && se >= 0; Q--, se--)
            if (M[Q] !== K[se]) {
              if (Q !== 1 || se !== 1)
                do
                  if (Q--, se--, se < 0 || M[Q] !== K[se]) {
                    var he = `
` + M[Q].replace(" at new ", " at ");
                    return c.displayName && he.includes("<anonymous>") && (he = he.replace("<anonymous>", c.displayName)), typeof c == "function" && _e.set(c, he), he;
                  }
                while (Q >= 1 && se >= 0);
              break;
            }
        }
      } finally {
        qe = !1, ze.current = I, Be(), Error.prepareStackTrace = P;
      }
      var me = c ? c.displayName || c.name : "", Xe = me ? Te(me) : "";
      return typeof c == "function" && _e.set(c, Xe), Xe;
    }
    function rt(c, y, A) {
      return L(c, !1);
    }
    function st(c) {
      var y = c.prototype;
      return !!(y && y.isReactComponent);
    }
    function Re(c, y, A) {
      if (c == null)
        return "";
      if (typeof c == "function")
        return L(c, st(c));
      if (typeof c == "string")
        return Te(c);
      switch (c) {
        case f:
          return Te("Suspense");
        case d:
          return Te("SuspenseList");
      }
      if (typeof c == "object")
        switch (c.$$typeof) {
          case u:
            return rt(c.render);
          case m:
            return Re(c.type, y, A);
          case h: {
            var C = c, P = C._payload, I = C._init;
            try {
              return Re(I(P), y, A);
            } catch {
            }
          }
        }
      return "";
    }
    var ke = Object.prototype.hasOwnProperty, Ct = {}, Vt = v.ReactDebugCurrentFrame;
    function Le(c) {
      if (c) {
        var y = c._owner, A = Re(c.type, c._source, y ? y.type : null);
        Vt.setExtraStackFrame(A);
      } else
        Vt.setExtraStackFrame(null);
    }
    function Nn(c, y, A, C, P) {
      {
        var I = Function.call.bind(ke);
        for (var B in c)
          if (I(c, B)) {
            var M = void 0;
            try {
              if (typeof c[B] != "function") {
                var K = Error((C || "React class") + ": " + A + " type `" + B + "` is invalid; it must be a function, usually from the `prop-types` package, but received `" + typeof c[B] + "`.This often happens because of typos such as `PropTypes.function` instead of `PropTypes.func`.");
                throw K.name = "Invariant Violation", K;
              }
              M = c[B](y, B, C, A, null, "SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED");
            } catch (Q) {
              M = Q;
            }
            M && !(M instanceof Error) && (Le(P), b("%s: type specification of %s `%s` is invalid; the type checker function must return `null` or an `Error` but returned a %s. You may have forgotten to pass an argument to the type checker creator (arrayOf, instanceOf, objectOf, oneOf, oneOfType, and shape all require an argument).", C || "React class", A, B, typeof M), Le(null)), M instanceof Error && !(M.message in Ct) && (Ct[M.message] = !0, Le(P), b("Failed %s type: %s", A, M.message), Le(null));
          }
      }
    }
    var vn = Array.isArray;
    function N(c) {
      return vn(c);
    }
    function V(c) {
      {
        var y = typeof Symbol == "function" && Symbol.toStringTag, A = y && c[Symbol.toStringTag] || c.constructor.name || "Object";
        return A;
      }
    }
    function $(c) {
      try {
        return U(c), !1;
      } catch {
        return !0;
      }
    }
    function U(c) {
      return "" + c;
    }
    function z(c) {
      if ($(c))
        return b("The provided key is an unsupported type %s. This value must be coerced to a string before before using it here.", V(c)), U(c);
    }
    var H = v.ReactCurrentOwner, de = {
      key: !0,
      ref: !0,
      __self: !0,
      __source: !0
    }, ve, pt;
    function ht(c) {
      if (ke.call(c, "ref")) {
        var y = Object.getOwnPropertyDescriptor(c, "ref").get;
        if (y && y.isReactWarning)
          return !1;
      }
      return c.ref !== void 0;
    }
    function yn(c) {
      if (ke.call(c, "key")) {
        var y = Object.getOwnPropertyDescriptor(c, "key").get;
        if (y && y.isReactWarning)
          return !1;
      }
      return c.key !== void 0;
    }
    function wn(c, y) {
      typeof c.ref == "string" && H.current;
    }
    function en(c, y) {
      {
        var A = function() {
          ve || (ve = !0, b("%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", y));
        };
        A.isReactWarning = !0, Object.defineProperty(c, "key", {
          get: A,
          configurable: !0
        });
      }
    }
    function En(c, y) {
      {
        var A = function() {
          pt || (pt = !0, b("%s: `ref` is not a prop. Trying to access it will result in `undefined` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://reactjs.org/link/special-props)", y));
        };
        A.isReactWarning = !0, Object.defineProperty(c, "ref", {
          get: A,
          configurable: !0
        });
      }
    }
    var Pr = function(c, y, A, C, P, I, B) {
      var M = {
        // This tag allows us to uniquely identify this as a React Element
        $$typeof: e,
        // Built-in properties that belong on the element
        type: c,
        key: y,
        ref: A,
        props: B,
        // Record the component responsible for creating this element.
        _owner: I
      };
      return M._store = {}, Object.defineProperty(M._store, "validated", {
        configurable: !1,
        enumerable: !1,
        writable: !0,
        value: !1
      }), Object.defineProperty(M, "_self", {
        configurable: !1,
        enumerable: !1,
        writable: !1,
        value: C
      }), Object.defineProperty(M, "_source", {
        configurable: !1,
        enumerable: !1,
        writable: !1,
        value: P
      }), Object.freeze && (Object.freeze(M.props), Object.freeze(M)), M;
    };
    function Ir(c, y, A, C, P) {
      {
        var I, B = {}, M = null, K = null;
        A !== void 0 && (z(A), M = "" + A), yn(y) && (z(y.key), M = "" + y.key), ht(y) && (K = y.ref, wn(y, P));
        for (I in y)
          ke.call(y, I) && !de.hasOwnProperty(I) && (B[I] = y[I]);
        if (c && c.defaultProps) {
          var Q = c.defaultProps;
          for (I in Q)
            B[I] === void 0 && (B[I] = Q[I]);
        }
        if (M || K) {
          var se = typeof c == "function" ? c.displayName || c.name || "Unknown" : c;
          M && en(B, se), K && En(B, se);
        }
        return Pr(c, M, K, P, C, H.current, B);
      }
    }
    var Sn = v.ReactCurrentOwner, tn = v.ReactDebugCurrentFrame;
    function gt(c) {
      if (c) {
        var y = c._owner, A = Re(c.type, c._source, y ? y.type : null);
        tn.setExtraStackFrame(A);
      } else
        tn.setExtraStackFrame(null);
    }
    var at;
    at = !1;
    function Ft(c) {
      return typeof c == "object" && c !== null && c.$$typeof === e;
    }
    function nn() {
      {
        if (Sn.current) {
          var c = q(Sn.current.type);
          if (c)
            return `

Check the render method of \`` + c + "`.";
        }
        return "";
      }
    }
    function Kn(c) {
      return "";
    }
    var Jn = {};
    function Qn(c) {
      {
        var y = nn();
        if (!y) {
          var A = typeof c == "string" ? c : c.displayName || c.name;
          A && (y = `

Check the top-level render call using <` + A + ">.");
        }
        return y;
      }
    }
    function Xn(c, y) {
      {
        if (!c._store || c._store.validated || c.key != null)
          return;
        c._store.validated = !0;
        var A = Qn(y);
        if (Jn[A])
          return;
        Jn[A] = !0;
        var C = "";
        c && c._owner && c._owner !== Sn.current && (C = " It was passed a child from " + q(c._owner.type) + "."), gt(c), b('Each child in a list should have a unique "key" prop.%s%s See https://reactjs.org/link/warning-keys for more information.', A, C), gt(null);
      }
    }
    function Dn(c, y) {
      {
        if (typeof c != "object")
          return;
        if (N(c))
          for (var A = 0; A < c.length; A++) {
            var C = c[A];
            Ft(C) && Xn(C, y);
          }
        else if (Ft(c))
          c._store && (c._store.validated = !0);
        else if (c) {
          var P = g(c);
          if (typeof P == "function" && P !== c.entries)
            for (var I = P.call(c), B; !(B = I.next()).done; )
              Ft(B.value) && Xn(B.value, y);
        }
      }
    }
    function Zn(c) {
      {
        var y = c.type;
        if (y == null || typeof y == "string")
          return;
        var A;
        if (typeof y == "function")
          A = y.propTypes;
        else if (typeof y == "object" && (y.$$typeof === u || // Note: Memo only checks outer props here.
        // Inner props are checked in the reconciler.
        y.$$typeof === m))
          A = y.propTypes;
        else
          return;
        if (A) {
          var C = q(y);
          Nn(A, c.props, "prop", C, c);
        } else if (y.PropTypes !== void 0 && !at) {
          at = !0;
          var P = q(y);
          b("Component %s declared `PropTypes` instead of `propTypes`. Did you misspell the property assignment?", P || "Unknown");
        }
        typeof y.getDefaultProps == "function" && !y.getDefaultProps.isReactClassApproved && b("getDefaultProps is only used on classic React.createClass definitions. Use a static property named `defaultProps` instead.");
      }
    }
    function $r(c) {
      {
        for (var y = Object.keys(c.props), A = 0; A < y.length; A++) {
          var C = y[A];
          if (C !== "children" && C !== "key") {
            gt(c), b("Invalid prop `%s` supplied to `React.Fragment`. React.Fragment can only have `key` and `children` props.", C), gt(null);
            break;
          }
        }
        c.ref !== null && (gt(c), b("Invalid attribute `ref` supplied to `React.Fragment`."), gt(null));
      }
    }
    var er = {};
    function An(c, y, A, C, P, I) {
      {
        var B = ne(c);
        if (!B) {
          var M = "";
          (c === void 0 || typeof c == "object" && c !== null && Object.keys(c).length === 0) && (M += " You likely forgot to export your component from the file it's defined in, or you might have mixed up default and named imports.");
          var K = Kn();
          K ? M += K : M += nn();
          var Q;
          c === null ? Q = "null" : N(c) ? Q = "array" : c !== void 0 && c.$$typeof === e ? (Q = "<" + (q(c.type) || "Unknown") + " />", M = " Did you accidentally export a JSX literal instead of a component?") : Q = typeof c, b("React.jsx: type is invalid -- expected a string (for built-in components) or a class/function (for composite components) but got: %s.%s", Q, M);
        }
        var se = Ir(c, y, A, P, I);
        if (se == null)
          return se;
        if (B) {
          var he = y.children;
          if (he !== void 0)
            if (C)
              if (N(he)) {
                for (var me = 0; me < he.length; me++)
                  Dn(he[me], c);
                Object.freeze && Object.freeze(he);
              } else
                b("React.jsx: Static children should always be an array. You are likely explicitly calling React.jsxs or React.jsxDEV. Use the Babel transform instead.");
            else
              Dn(he, c);
        }
        if (ke.call(y, "key")) {
          var Xe = q(c), ye = Object.keys(y).filter(function(hl) {
            return hl !== "key";
          }), jn = ye.length > 0 ? "{key: someKey, " + ye.join(": ..., ") + ": ...}" : "{key: someKey}";
          if (!er[Xe + jn]) {
            var pl = ye.length > 0 ? "{" + ye.join(": ..., ") + ": ...}" : "{}";
            b(`A props object containing a "key" prop is being spread into JSX:
  let props = %s;
  <%s {...props} />
React keys must be passed directly to JSX without using spread:
  let props = %s;
  <%s key={someKey} {...props} />`, jn, Xe, pl, Xe), er[Xe + jn] = !0;
          }
        }
        return c === r ? $r(se) : Zn(se), se;
      }
    }
    function kr(c, y, A) {
      return An(c, y, A, !0);
    }
    function Lr(c, y, A) {
      return An(c, y, A, !1);
    }
    var p = Lr, T = kr;
    Rn.Fragment = r, Rn.jsx = p, Rn.jsxs = T;
  }()), Rn;
}
process.env.NODE_ENV === "production" ? ds.exports = Im() : ds.exports = $m();
var fe = ds.exports;
function Ys(t, e = []) {
  let n = [];
  function r(a, i) {
    const l = O.createContext(i), u = n.length;
    n = [...n, i];
    const f = (m) => {
      var v;
      const { scope: h, children: S, ...x } = m, E = ((v = h == null ? void 0 : h[t]) == null ? void 0 : v[u]) || l, g = O.useMemo(() => x, Object.values(x));
      return /* @__PURE__ */ fe.jsx(E.Provider, { value: g, children: S });
    };
    f.displayName = a + "Provider";
    function d(m, h) {
      var E;
      const S = ((E = h == null ? void 0 : h[t]) == null ? void 0 : E[u]) || l, x = O.useContext(S);
      if (x) return x;
      if (i !== void 0) return i;
      throw new Error(`\`${m}\` must be used within \`${a}\``);
    }
    return [f, d];
  }
  const s = () => {
    const a = n.map((i) => O.createContext(i));
    return function(l) {
      const u = (l == null ? void 0 : l[t]) || a;
      return O.useMemo(
        () => ({ [`__scope${t}`]: { ...l, [t]: u } }),
        [l, u]
      );
    };
  };
  return s.scopeName = t, [r, km(s, ...e)];
}
function km(...t) {
  const e = t[0];
  if (t.length === 1) return e;
  const n = () => {
    const r = t.map((s) => ({
      useScope: s(),
      scopeName: s.scopeName
    }));
    return function(a) {
      const i = r.reduce((l, { useScope: u, scopeName: f }) => {
        const m = u(a)[`__scope${f}`];
        return { ...l, ...m };
      }, {});
      return O.useMemo(() => ({ [`__scope${e.scopeName}`]: i }), [i]);
    };
  };
  return n.scopeName = e.scopeName, n;
}
function Ga(t, e) {
  if (typeof t == "function")
    return t(e);
  t != null && (t.current = e);
}
function No(...t) {
  return (e) => {
    let n = !1;
    const r = t.map((s) => {
      const a = Ga(s, e);
      return !n && typeof a == "function" && (n = !0), a;
    });
    if (n)
      return () => {
        for (let s = 0; s < r.length; s++) {
          const a = r[s];
          typeof a == "function" ? a() : Ga(t[s], null);
        }
      };
  };
}
function hr(...t) {
  return O.useCallback(No(...t), t);
}
// @__NO_SIDE_EFFECTS__
function fs(t) {
  const e = /* @__PURE__ */ Lm(t), n = O.forwardRef((r, s) => {
    const { children: a, ...i } = r, l = O.Children.toArray(a), u = l.find(Um);
    if (u) {
      const f = u.props.children, d = l.map((m) => m === u ? O.Children.count(f) > 1 ? O.Children.only(null) : O.isValidElement(f) ? f.props.children : null : m);
      return /* @__PURE__ */ fe.jsx(e, { ...i, ref: s, children: O.isValidElement(f) ? O.cloneElement(f, void 0, d) : null });
    }
    return /* @__PURE__ */ fe.jsx(e, { ...i, ref: s, children: a });
  });
  return n.displayName = `${t}.Slot`, n;
}
// @__NO_SIDE_EFFECTS__
function Lm(t) {
  const e = O.forwardRef((n, r) => {
    const { children: s, ...a } = n;
    if (O.isValidElement(s)) {
      const i = zm(s), l = Bm(a, s.props);
      return s.type !== O.Fragment && (l.ref = r ? No(r, i) : i), O.cloneElement(s, l);
    }
    return O.Children.count(s) > 1 ? O.Children.only(null) : null;
  });
  return e.displayName = `${t}.SlotClone`, e;
}
var Mm = Symbol("radix.slottable");
function Um(t) {
  return O.isValidElement(t) && typeof t.type == "function" && "__radixId" in t.type && t.type.__radixId === Mm;
}
function Bm(t, e) {
  const n = { ...e };
  for (const r in e) {
    const s = t[r], a = e[r];
    /^on[A-Z]/.test(r) ? s && a ? n[r] = (...l) => {
      const u = a(...l);
      return s(...l), u;
    } : s && (n[r] = s) : r === "style" ? n[r] = { ...s, ...a } : r === "className" && (n[r] = [s, a].filter(Boolean).join(" "));
  }
  return { ...t, ...n };
}
function zm(t) {
  var r, s;
  let e = (r = Object.getOwnPropertyDescriptor(t.props, "ref")) == null ? void 0 : r.get, n = e && "isReactWarning" in e && e.isReactWarning;
  return n ? t.ref : (e = (s = Object.getOwnPropertyDescriptor(t, "ref")) == null ? void 0 : s.get, n = e && "isReactWarning" in e && e.isReactWarning, n ? t.props.ref : t.props.ref || t.ref);
}
function qm(t) {
  const e = t + "CollectionProvider", [n, r] = Ys(e), [s, a] = n(
    e,
    { collectionRef: { current: null }, itemMap: /* @__PURE__ */ new Map() }
  ), i = (E) => {
    const { scope: g, children: v } = E, b = ot.useRef(null), j = ot.useRef(/* @__PURE__ */ new Map()).current;
    return /* @__PURE__ */ fe.jsx(s, { scope: g, itemMap: j, collectionRef: b, children: v });
  };
  i.displayName = e;
  const l = t + "CollectionSlot", u = /* @__PURE__ */ fs(l), f = ot.forwardRef(
    (E, g) => {
      const { scope: v, children: b } = E, j = a(l, v), F = hr(g, j.collectionRef);
      return /* @__PURE__ */ fe.jsx(u, { ref: F, children: b });
    }
  );
  f.displayName = l;
  const d = t + "CollectionItemSlot", m = "data-radix-collection-item", h = /* @__PURE__ */ fs(d), S = ot.forwardRef(
    (E, g) => {
      const { scope: v, children: b, ...j } = E, F = ot.useRef(null), D = hr(g, F), R = a(d, v);
      return ot.useEffect(() => (R.itemMap.set(F, { ref: F, ...j }), () => void R.itemMap.delete(F))), /* @__PURE__ */ fe.jsx(h, { [m]: "", ref: D, children: b });
    }
  );
  S.displayName = d;
  function x(E) {
    const g = a(t + "CollectionConsumer", E);
    return ot.useCallback(() => {
      const b = g.collectionRef.current;
      if (!b) return [];
      const j = Array.from(b.querySelectorAll(`[${m}]`));
      return Array.from(g.itemMap.values()).sort(
        (R, k) => j.indexOf(R.ref.current) - j.indexOf(k.ref.current)
      );
    }, [g.collectionRef, g.itemMap]);
  }
  return [
    { Provider: i, Slot: f, ItemSlot: S },
    x,
    r
  ];
}
var gr = globalThis != null && globalThis.document ? O.useLayoutEffect : () => {
}, Wm = O[" useId ".trim().toString()] || (() => {
}), Ym = 0;
function vo(t) {
  const [e, n] = O.useState(Wm());
  return gr(() => {
    n((r) => r ?? String(Ym++));
  }, [t]), t || (e ? `radix-${e}` : "");
}
var Hm = [
  "a",
  "button",
  "div",
  "form",
  "h2",
  "h3",
  "img",
  "input",
  "label",
  "li",
  "nav",
  "ol",
  "p",
  "select",
  "span",
  "svg",
  "ul"
], gn = Hm.reduce((t, e) => {
  const n = /* @__PURE__ */ fs(`Primitive.${e}`), r = O.forwardRef((s, a) => {
    const { asChild: i, ...l } = s, u = i ? n : e;
    return typeof window < "u" && (window[Symbol.for("radix-ui")] = !0), /* @__PURE__ */ fe.jsx(u, { ...l, ref: a });
  });
  return r.displayName = `Primitive.${e}`, { ...t, [e]: r };
}, {});
function Gm(t) {
  const e = O.useRef(t);
  return O.useEffect(() => {
    e.current = t;
  }), O.useMemo(() => (...n) => {
    var r;
    return (r = e.current) == null ? void 0 : r.call(e, ...n);
  }, []);
}
var Km = O[" useInsertionEffect ".trim().toString()] || gr;
function yo({
  prop: t,
  defaultProp: e,
  onChange: n = () => {
  },
  caller: r
}) {
  const [s, a, i] = Jm({
    defaultProp: e,
    onChange: n
  }), l = t !== void 0, u = l ? t : s;
  {
    const d = O.useRef(t !== void 0);
    O.useEffect(() => {
      const m = d.current;
      m !== l && console.warn(
        `${r} is changing from ${m ? "controlled" : "uncontrolled"} to ${l ? "controlled" : "uncontrolled"}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`
      ), d.current = l;
    }, [l, r]);
  }
  const f = O.useCallback(
    (d) => {
      var m;
      if (l) {
        const h = Qm(d) ? d(t) : d;
        h !== t && ((m = i.current) == null || m.call(i, h));
      } else
        a(d);
    },
    [l, t, a, i]
  );
  return [u, f];
}
function Jm({
  defaultProp: t,
  onChange: e
}) {
  const [n, r] = O.useState(t), s = O.useRef(n), a = O.useRef(e);
  return Km(() => {
    a.current = e;
  }, [e]), O.useEffect(() => {
    var i;
    s.current !== n && ((i = a.current) == null || i.call(a, n), s.current = n);
  }, [n, s]), [n, r, a];
}
function Qm(t) {
  return typeof t == "function";
}
var Xm = O.createContext(void 0);
function wo(t) {
  const e = O.useContext(Xm);
  return t || e || "ltr";
}
var Hr = "rovingFocusGroup.onEntryFocus", Zm = { bubbles: !1, cancelable: !0 }, Wn = "RovingFocusGroup", [ms, Eo, ep] = qm(Wn), [tp, So] = Ys(
  Wn,
  [ep]
), [np, rp] = tp(Wn), Do = O.forwardRef(
  (t, e) => /* @__PURE__ */ fe.jsx(ms.Provider, { scope: t.__scopeRovingFocusGroup, children: /* @__PURE__ */ fe.jsx(ms.Slot, { scope: t.__scopeRovingFocusGroup, children: /* @__PURE__ */ fe.jsx(sp, { ...t, ref: e }) }) })
);
Do.displayName = Wn;
var sp = O.forwardRef((t, e) => {
  const {
    __scopeRovingFocusGroup: n,
    orientation: r,
    loop: s = !1,
    dir: a,
    currentTabStopId: i,
    defaultCurrentTabStopId: l,
    onCurrentTabStopIdChange: u,
    onEntryFocus: f,
    preventScrollOnEntryFocus: d = !1,
    ...m
  } = t, h = O.useRef(null), S = hr(e, h), x = wo(a), [E, g] = yo({
    prop: i,
    defaultProp: l ?? null,
    onChange: u,
    caller: Wn
  }), [v, b] = O.useState(!1), j = Gm(f), F = Eo(n), D = O.useRef(!1), [R, k] = O.useState(0);
  return O.useEffect(() => {
    const Y = h.current;
    if (Y)
      return Y.addEventListener(Hr, j), () => Y.removeEventListener(Hr, j);
  }, [j]), /* @__PURE__ */ fe.jsx(
    np,
    {
      scope: n,
      orientation: r,
      dir: x,
      loop: s,
      currentTabStopId: E,
      onItemFocus: O.useCallback(
        (Y) => g(Y),
        [g]
      ),
      onItemShiftTab: O.useCallback(() => b(!0), []),
      onFocusableItemAdd: O.useCallback(
        () => k((Y) => Y + 1),
        []
      ),
      onFocusableItemRemove: O.useCallback(
        () => k((Y) => Y - 1),
        []
      ),
      children: /* @__PURE__ */ fe.jsx(
        gn.div,
        {
          tabIndex: v || R === 0 ? -1 : 0,
          "data-orientation": r,
          ...m,
          ref: S,
          style: { outline: "none", ...t.style },
          onMouseDown: Nt(t.onMouseDown, () => {
            D.current = !0;
          }),
          onFocus: Nt(t.onFocus, (Y) => {
            const ue = !D.current;
            if (Y.target === Y.currentTarget && ue && !v) {
              const ne = new CustomEvent(Hr, Zm);
              if (Y.currentTarget.dispatchEvent(ne), !ne.defaultPrevented) {
                const G = F().filter((Ne) => Ne.focusable), ae = G.find((Ne) => Ne.active), q = G.find((Ne) => Ne.id === E), be = [ae, q, ...G].filter(
                  Boolean
                ).map((Ne) => Ne.ref.current);
                To(be, d);
              }
            }
            D.current = !1;
          }),
          onBlur: Nt(t.onBlur, () => b(!1))
        }
      )
    }
  );
}), Ao = "RovingFocusGroupItem", jo = O.forwardRef(
  (t, e) => {
    const {
      __scopeRovingFocusGroup: n,
      focusable: r = !0,
      active: s = !1,
      tabStopId: a,
      children: i,
      ...l
    } = t, u = vo(), f = a || u, d = rp(Ao, n), m = d.currentTabStopId === f, h = Eo(n), { onFocusableItemAdd: S, onFocusableItemRemove: x, currentTabStopId: E } = d;
    return O.useEffect(() => {
      if (r)
        return S(), () => x();
    }, [r, S, x]), /* @__PURE__ */ fe.jsx(
      ms.ItemSlot,
      {
        scope: n,
        id: f,
        focusable: r,
        active: s,
        children: /* @__PURE__ */ fe.jsx(
          gn.span,
          {
            tabIndex: m ? 0 : -1,
            "data-orientation": d.orientation,
            ...l,
            ref: e,
            onMouseDown: Nt(t.onMouseDown, (g) => {
              r ? d.onItemFocus(f) : g.preventDefault();
            }),
            onFocus: Nt(t.onFocus, () => d.onItemFocus(f)),
            onKeyDown: Nt(t.onKeyDown, (g) => {
              if (g.key === "Tab" && g.shiftKey) {
                d.onItemShiftTab();
                return;
              }
              if (g.target !== g.currentTarget) return;
              const v = op(g, d.orientation, d.dir);
              if (v !== void 0) {
                if (g.metaKey || g.ctrlKey || g.altKey || g.shiftKey) return;
                g.preventDefault();
                let j = h().filter((F) => F.focusable).map((F) => F.ref.current);
                if (v === "last") j.reverse();
                else if (v === "prev" || v === "next") {
                  v === "prev" && j.reverse();
                  const F = j.indexOf(g.currentTarget);
                  j = d.loop ? lp(j, F + 1) : j.slice(F + 1);
                }
                setTimeout(() => To(j));
              }
            }),
            children: typeof i == "function" ? i({ isCurrentTabStop: m, hasTabStop: E != null }) : i
          }
        )
      }
    );
  }
);
jo.displayName = Ao;
var ap = {
  ArrowLeft: "prev",
  ArrowUp: "prev",
  ArrowRight: "next",
  ArrowDown: "next",
  PageUp: "first",
  Home: "first",
  PageDown: "last",
  End: "last"
};
function ip(t, e) {
  return e !== "rtl" ? t : t === "ArrowLeft" ? "ArrowRight" : t === "ArrowRight" ? "ArrowLeft" : t;
}
function op(t, e, n) {
  const r = ip(t.key, n);
  if (!(e === "vertical" && ["ArrowLeft", "ArrowRight"].includes(r)) && !(e === "horizontal" && ["ArrowUp", "ArrowDown"].includes(r)))
    return ap[r];
}
function To(t, e = !1) {
  const n = document.activeElement;
  for (const r of t)
    if (r === n || (r.focus({ preventScroll: e }), document.activeElement !== n)) return;
}
function lp(t, e) {
  return t.map((n, r) => t[(e + r) % t.length]);
}
var up = Do, cp = jo;
function dp(t, e) {
  return O.useReducer((n, r) => e[n][r] ?? n, t);
}
var _o = (t) => {
  const { present: e, children: n } = t, r = fp(e), s = typeof n == "function" ? n({ present: r.isPresent }) : O.Children.only(n), a = hr(r.ref, mp(s));
  return typeof n == "function" || r.isPresent ? O.cloneElement(s, { ref: a }) : null;
};
_o.displayName = "Presence";
function fp(t) {
  const [e, n] = O.useState(), r = O.useRef(null), s = O.useRef(t), a = O.useRef("none"), i = t ? "mounted" : "unmounted", [l, u] = dp(i, {
    mounted: {
      UNMOUNT: "unmounted",
      ANIMATION_OUT: "unmountSuspended"
    },
    unmountSuspended: {
      MOUNT: "mounted",
      ANIMATION_END: "unmounted"
    },
    unmounted: {
      MOUNT: "mounted"
    }
  });
  return O.useEffect(() => {
    const f = ir(r.current);
    a.current = l === "mounted" ? f : "none";
  }, [l]), gr(() => {
    const f = r.current, d = s.current;
    if (d !== t) {
      const h = a.current, S = ir(f);
      t ? u("MOUNT") : S === "none" || (f == null ? void 0 : f.display) === "none" ? u("UNMOUNT") : u(d && h !== S ? "ANIMATION_OUT" : "UNMOUNT"), s.current = t;
    }
  }, [t, u]), gr(() => {
    if (e) {
      let f;
      const d = e.ownerDocument.defaultView ?? window, m = (S) => {
        const E = ir(r.current).includes(S.animationName);
        if (S.target === e && E && (u("ANIMATION_END"), !s.current)) {
          const g = e.style.animationFillMode;
          e.style.animationFillMode = "forwards", f = d.setTimeout(() => {
            e.style.animationFillMode === "forwards" && (e.style.animationFillMode = g);
          });
        }
      }, h = (S) => {
        S.target === e && (a.current = ir(r.current));
      };
      return e.addEventListener("animationstart", h), e.addEventListener("animationcancel", m), e.addEventListener("animationend", m), () => {
        d.clearTimeout(f), e.removeEventListener("animationstart", h), e.removeEventListener("animationcancel", m), e.removeEventListener("animationend", m);
      };
    } else
      u("ANIMATION_END");
  }, [e, u]), {
    isPresent: ["mounted", "unmountSuspended"].includes(l),
    ref: O.useCallback((f) => {
      r.current = f ? getComputedStyle(f) : null, n(f);
    }, [])
  };
}
function ir(t) {
  return (t == null ? void 0 : t.animationName) || "none";
}
function mp(t) {
  var r, s;
  let e = (r = Object.getOwnPropertyDescriptor(t.props, "ref")) == null ? void 0 : r.get, n = e && "isReactWarning" in e && e.isReactWarning;
  return n ? t.ref : (e = (s = Object.getOwnPropertyDescriptor(t, "ref")) == null ? void 0 : s.get, n = e && "isReactWarning" in e && e.isReactWarning, n ? t.props.ref : t.props.ref || t.ref);
}
var jr = "Tabs", [pp, jg] = Ys(jr, [
  So
]), Ro = So(), [hp, Hs] = pp(jr), Oo = O.forwardRef(
  (t, e) => {
    const {
      __scopeTabs: n,
      value: r,
      onValueChange: s,
      defaultValue: a,
      orientation: i = "horizontal",
      dir: l,
      activationMode: u = "automatic",
      ...f
    } = t, d = wo(l), [m, h] = yo({
      prop: r,
      onChange: s,
      defaultProp: a ?? "",
      caller: jr
    });
    return /* @__PURE__ */ fe.jsx(
      hp,
      {
        scope: n,
        baseId: vo(),
        value: m,
        onValueChange: h,
        orientation: i,
        dir: d,
        activationMode: u,
        children: /* @__PURE__ */ fe.jsx(
          gn.div,
          {
            dir: d,
            "data-orientation": i,
            ...f,
            ref: e
          }
        )
      }
    );
  }
);
Oo.displayName = jr;
var Co = "TabsList", Vo = O.forwardRef(
  (t, e) => {
    const { __scopeTabs: n, loop: r = !0, ...s } = t, a = Hs(Co, n), i = Ro(n);
    return /* @__PURE__ */ fe.jsx(
      up,
      {
        asChild: !0,
        ...i,
        orientation: a.orientation,
        dir: a.dir,
        loop: r,
        children: /* @__PURE__ */ fe.jsx(
          gn.div,
          {
            role: "tablist",
            "aria-orientation": a.orientation,
            ...s,
            ref: e
          }
        )
      }
    );
  }
);
Vo.displayName = Co;
var Fo = "TabsTrigger", Po = O.forwardRef(
  (t, e) => {
    const { __scopeTabs: n, value: r, disabled: s = !1, ...a } = t, i = Hs(Fo, n), l = Ro(n), u = ko(i.baseId, r), f = Lo(i.baseId, r), d = r === i.value;
    return /* @__PURE__ */ fe.jsx(
      cp,
      {
        asChild: !0,
        ...l,
        focusable: !s,
        active: d,
        children: /* @__PURE__ */ fe.jsx(
          gn.button,
          {
            type: "button",
            role: "tab",
            "aria-selected": d,
            "aria-controls": f,
            "data-state": d ? "active" : "inactive",
            "data-disabled": s ? "" : void 0,
            disabled: s,
            id: u,
            ...a,
            ref: e,
            onMouseDown: Nt(t.onMouseDown, (m) => {
              !s && m.button === 0 && m.ctrlKey === !1 ? i.onValueChange(r) : m.preventDefault();
            }),
            onKeyDown: Nt(t.onKeyDown, (m) => {
              [" ", "Enter"].includes(m.key) && i.onValueChange(r);
            }),
            onFocus: Nt(t.onFocus, () => {
              const m = i.activationMode !== "manual";
              !d && !s && m && i.onValueChange(r);
            })
          }
        )
      }
    );
  }
);
Po.displayName = Fo;
var Io = "TabsContent", $o = O.forwardRef(
  (t, e) => {
    const { __scopeTabs: n, value: r, forceMount: s, children: a, ...i } = t, l = Hs(Io, n), u = ko(l.baseId, r), f = Lo(l.baseId, r), d = r === l.value, m = O.useRef(d);
    return O.useEffect(() => {
      const h = requestAnimationFrame(() => m.current = !1);
      return () => cancelAnimationFrame(h);
    }, []), /* @__PURE__ */ fe.jsx(_o, { present: s || d, children: ({ present: h }) => /* @__PURE__ */ fe.jsx(
      gn.div,
      {
        "data-state": d ? "active" : "inactive",
        "data-orientation": l.orientation,
        role: "tabpanel",
        "aria-labelledby": u,
        hidden: !h,
        id: f,
        tabIndex: 0,
        ...i,
        ref: e,
        style: {
          ...t.style,
          animationDuration: m.current ? "0s" : void 0
        },
        children: h && a
      }
    ) });
  }
);
$o.displayName = Io;
function ko(t, e) {
  return `${t}-trigger-${e}`;
}
function Lo(t, e) {
  return `${t}-content-${e}`;
}
var Gs = Oo, Ks = Vo, He = Po, Ge = $o;
function Mo(t, e) {
  return function() {
    return t.apply(e, arguments);
  };
}
const { toString: gp } = Object.prototype, { getPrototypeOf: Js } = Object, { iterator: Tr, toStringTag: Uo } = Symbol, _r = /* @__PURE__ */ ((t) => (e) => {
  const n = gp.call(e);
  return t[n] || (t[n] = n.slice(8, -1).toLowerCase());
})(/* @__PURE__ */ Object.create(null)), et = (t) => (t = t.toLowerCase(), (e) => _r(e) === t), Rr = (t) => (e) => typeof e === t, { isArray: xn } = Array, Ln = Rr("undefined");
function xp(t) {
  return t !== null && !Ln(t) && t.constructor !== null && !Ln(t.constructor) && Pe(t.constructor.isBuffer) && t.constructor.isBuffer(t);
}
const Bo = et("ArrayBuffer");
function bp(t) {
  let e;
  return typeof ArrayBuffer < "u" && ArrayBuffer.isView ? e = ArrayBuffer.isView(t) : e = t && t.buffer && Bo(t.buffer), e;
}
const Np = Rr("string"), Pe = Rr("function"), zo = Rr("number"), Or = (t) => t !== null && typeof t == "object", vp = (t) => t === !0 || t === !1, ur = (t) => {
  if (_r(t) !== "object")
    return !1;
  const e = Js(t);
  return (e === null || e === Object.prototype || Object.getPrototypeOf(e) === null) && !(Uo in t) && !(Tr in t);
}, yp = et("Date"), wp = et("File"), Ep = et("Blob"), Sp = et("FileList"), Dp = (t) => Or(t) && Pe(t.pipe), Ap = (t) => {
  let e;
  return t && (typeof FormData == "function" && t instanceof FormData || Pe(t.append) && ((e = _r(t)) === "formdata" || // detect form-data instance
  e === "object" && Pe(t.toString) && t.toString() === "[object FormData]"));
}, jp = et("URLSearchParams"), [Tp, _p, Rp, Op] = ["ReadableStream", "Request", "Response", "Headers"].map(et), Cp = (t) => t.trim ? t.trim() : t.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
function Yn(t, e, { allOwnKeys: n = !1 } = {}) {
  if (t === null || typeof t > "u")
    return;
  let r, s;
  if (typeof t != "object" && (t = [t]), xn(t))
    for (r = 0, s = t.length; r < s; r++)
      e.call(null, t[r], r, t);
  else {
    const a = n ? Object.getOwnPropertyNames(t) : Object.keys(t), i = a.length;
    let l;
    for (r = 0; r < i; r++)
      l = a[r], e.call(null, t[l], l, t);
  }
}
function qo(t, e) {
  e = e.toLowerCase();
  const n = Object.keys(t);
  let r = n.length, s;
  for (; r-- > 0; )
    if (s = n[r], e === s.toLowerCase())
      return s;
  return null;
}
const kt = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : global, Wo = (t) => !Ln(t) && t !== kt;
function ps() {
  const { caseless: t } = Wo(this) && this || {}, e = {}, n = (r, s) => {
    const a = t && qo(e, s) || s;
    ur(e[a]) && ur(r) ? e[a] = ps(e[a], r) : ur(r) ? e[a] = ps({}, r) : xn(r) ? e[a] = r.slice() : e[a] = r;
  };
  for (let r = 0, s = arguments.length; r < s; r++)
    arguments[r] && Yn(arguments[r], n);
  return e;
}
const Vp = (t, e, n, { allOwnKeys: r } = {}) => (Yn(e, (s, a) => {
  n && Pe(s) ? t[a] = Mo(s, n) : t[a] = s;
}, { allOwnKeys: r }), t), Fp = (t) => (t.charCodeAt(0) === 65279 && (t = t.slice(1)), t), Pp = (t, e, n, r) => {
  t.prototype = Object.create(e.prototype, r), t.prototype.constructor = t, Object.defineProperty(t, "super", {
    value: e.prototype
  }), n && Object.assign(t.prototype, n);
}, Ip = (t, e, n, r) => {
  let s, a, i;
  const l = {};
  if (e = e || {}, t == null) return e;
  do {
    for (s = Object.getOwnPropertyNames(t), a = s.length; a-- > 0; )
      i = s[a], (!r || r(i, t, e)) && !l[i] && (e[i] = t[i], l[i] = !0);
    t = n !== !1 && Js(t);
  } while (t && (!n || n(t, e)) && t !== Object.prototype);
  return e;
}, $p = (t, e, n) => {
  t = String(t), (n === void 0 || n > t.length) && (n = t.length), n -= e.length;
  const r = t.indexOf(e, n);
  return r !== -1 && r === n;
}, kp = (t) => {
  if (!t) return null;
  if (xn(t)) return t;
  let e = t.length;
  if (!zo(e)) return null;
  const n = new Array(e);
  for (; e-- > 0; )
    n[e] = t[e];
  return n;
}, Lp = /* @__PURE__ */ ((t) => (e) => t && e instanceof t)(typeof Uint8Array < "u" && Js(Uint8Array)), Mp = (t, e) => {
  const r = (t && t[Tr]).call(t);
  let s;
  for (; (s = r.next()) && !s.done; ) {
    const a = s.value;
    e.call(t, a[0], a[1]);
  }
}, Up = (t, e) => {
  let n;
  const r = [];
  for (; (n = t.exec(e)) !== null; )
    r.push(n);
  return r;
}, Bp = et("HTMLFormElement"), zp = (t) => t.toLowerCase().replace(
  /[-_\s]([a-z\d])(\w*)/g,
  function(n, r, s) {
    return r.toUpperCase() + s;
  }
), Ka = (({ hasOwnProperty: t }) => (e, n) => t.call(e, n))(Object.prototype), qp = et("RegExp"), Yo = (t, e) => {
  const n = Object.getOwnPropertyDescriptors(t), r = {};
  Yn(n, (s, a) => {
    let i;
    (i = e(s, a, t)) !== !1 && (r[a] = i || s);
  }), Object.defineProperties(t, r);
}, Wp = (t) => {
  Yo(t, (e, n) => {
    if (Pe(t) && ["arguments", "caller", "callee"].indexOf(n) !== -1)
      return !1;
    const r = t[n];
    if (Pe(r)) {
      if (e.enumerable = !1, "writable" in e) {
        e.writable = !1;
        return;
      }
      e.set || (e.set = () => {
        throw Error("Can not rewrite read-only method '" + n + "'");
      });
    }
  });
}, Yp = (t, e) => {
  const n = {}, r = (s) => {
    s.forEach((a) => {
      n[a] = !0;
    });
  };
  return xn(t) ? r(t) : r(String(t).split(e)), n;
}, Hp = () => {
}, Gp = (t, e) => t != null && Number.isFinite(t = +t) ? t : e;
function Kp(t) {
  return !!(t && Pe(t.append) && t[Uo] === "FormData" && t[Tr]);
}
const Jp = (t) => {
  const e = new Array(10), n = (r, s) => {
    if (Or(r)) {
      if (e.indexOf(r) >= 0)
        return;
      if (!("toJSON" in r)) {
        e[s] = r;
        const a = xn(r) ? [] : {};
        return Yn(r, (i, l) => {
          const u = n(i, s + 1);
          !Ln(u) && (a[l] = u);
        }), e[s] = void 0, a;
      }
    }
    return r;
  };
  return n(t, 0);
}, Qp = et("AsyncFunction"), Xp = (t) => t && (Or(t) || Pe(t)) && Pe(t.then) && Pe(t.catch), Ho = ((t, e) => t ? setImmediate : e ? ((n, r) => (kt.addEventListener("message", ({ source: s, data: a }) => {
  s === kt && a === n && r.length && r.shift()();
}, !1), (s) => {
  r.push(s), kt.postMessage(n, "*");
}))(`axios@${Math.random()}`, []) : (n) => setTimeout(n))(
  typeof setImmediate == "function",
  Pe(kt.postMessage)
), Zp = typeof queueMicrotask < "u" ? queueMicrotask.bind(kt) : typeof process < "u" && process.nextTick || Ho, eh = (t) => t != null && Pe(t[Tr]), w = {
  isArray: xn,
  isArrayBuffer: Bo,
  isBuffer: xp,
  isFormData: Ap,
  isArrayBufferView: bp,
  isString: Np,
  isNumber: zo,
  isBoolean: vp,
  isObject: Or,
  isPlainObject: ur,
  isReadableStream: Tp,
  isRequest: _p,
  isResponse: Rp,
  isHeaders: Op,
  isUndefined: Ln,
  isDate: yp,
  isFile: wp,
  isBlob: Ep,
  isRegExp: qp,
  isFunction: Pe,
  isStream: Dp,
  isURLSearchParams: jp,
  isTypedArray: Lp,
  isFileList: Sp,
  forEach: Yn,
  merge: ps,
  extend: Vp,
  trim: Cp,
  stripBOM: Fp,
  inherits: Pp,
  toFlatObject: Ip,
  kindOf: _r,
  kindOfTest: et,
  endsWith: $p,
  toArray: kp,
  forEachEntry: Mp,
  matchAll: Up,
  isHTMLForm: Bp,
  hasOwnProperty: Ka,
  hasOwnProp: Ka,
  // an alias to avoid ESLint no-prototype-builtins detection
  reduceDescriptors: Yo,
  freezeMethods: Wp,
  toObjectSet: Yp,
  toCamelCase: zp,
  noop: Hp,
  toFiniteNumber: Gp,
  findKey: qo,
  global: kt,
  isContextDefined: Wo,
  isSpecCompliantForm: Kp,
  toJSONObject: Jp,
  isAsyncFn: Qp,
  isThenable: Xp,
  setImmediate: Ho,
  asap: Zp,
  isIterable: eh
};
function W(t, e, n, r, s) {
  Error.call(this), Error.captureStackTrace ? Error.captureStackTrace(this, this.constructor) : this.stack = new Error().stack, this.message = t, this.name = "AxiosError", e && (this.code = e), n && (this.config = n), r && (this.request = r), s && (this.response = s, this.status = s.status ? s.status : null);
}
w.inherits(W, Error, {
  toJSON: function() {
    return {
      // Standard
      message: this.message,
      name: this.name,
      // Microsoft
      description: this.description,
      number: this.number,
      // Mozilla
      fileName: this.fileName,
      lineNumber: this.lineNumber,
      columnNumber: this.columnNumber,
      stack: this.stack,
      // Axios
      config: w.toJSONObject(this.config),
      code: this.code,
      status: this.status
    };
  }
});
const Go = W.prototype, Ko = {};
[
  "ERR_BAD_OPTION_VALUE",
  "ERR_BAD_OPTION",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ERR_NETWORK",
  "ERR_FR_TOO_MANY_REDIRECTS",
  "ERR_DEPRECATED",
  "ERR_BAD_RESPONSE",
  "ERR_BAD_REQUEST",
  "ERR_CANCELED",
  "ERR_NOT_SUPPORT",
  "ERR_INVALID_URL"
  // eslint-disable-next-line func-names
].forEach((t) => {
  Ko[t] = { value: t };
});
Object.defineProperties(W, Ko);
Object.defineProperty(Go, "isAxiosError", { value: !0 });
W.from = (t, e, n, r, s, a) => {
  const i = Object.create(Go);
  return w.toFlatObject(t, i, function(u) {
    return u !== Error.prototype;
  }, (l) => l !== "isAxiosError"), W.call(i, t.message, e, n, r, s), i.cause = t, i.name = t.name, a && Object.assign(i, a), i;
};
const th = null;
function hs(t) {
  return w.isPlainObject(t) || w.isArray(t);
}
function Jo(t) {
  return w.endsWith(t, "[]") ? t.slice(0, -2) : t;
}
function Ja(t, e, n) {
  return t ? t.concat(e).map(function(s, a) {
    return s = Jo(s), !n && a ? "[" + s + "]" : s;
  }).join(n ? "." : "") : e;
}
function nh(t) {
  return w.isArray(t) && !t.some(hs);
}
const rh = w.toFlatObject(w, {}, null, function(e) {
  return /^is[A-Z]/.test(e);
});
function Cr(t, e, n) {
  if (!w.isObject(t))
    throw new TypeError("target must be an object");
  e = e || new FormData(), n = w.toFlatObject(n, {
    metaTokens: !0,
    dots: !1,
    indexes: !1
  }, !1, function(E, g) {
    return !w.isUndefined(g[E]);
  });
  const r = n.metaTokens, s = n.visitor || d, a = n.dots, i = n.indexes, u = (n.Blob || typeof Blob < "u" && Blob) && w.isSpecCompliantForm(e);
  if (!w.isFunction(s))
    throw new TypeError("visitor must be a function");
  function f(x) {
    if (x === null) return "";
    if (w.isDate(x))
      return x.toISOString();
    if (!u && w.isBlob(x))
      throw new W("Blob is not supported. Use a Buffer instead.");
    return w.isArrayBuffer(x) || w.isTypedArray(x) ? u && typeof Blob == "function" ? new Blob([x]) : Buffer.from(x) : x;
  }
  function d(x, E, g) {
    let v = x;
    if (x && !g && typeof x == "object") {
      if (w.endsWith(E, "{}"))
        E = r ? E : E.slice(0, -2), x = JSON.stringify(x);
      else if (w.isArray(x) && nh(x) || (w.isFileList(x) || w.endsWith(E, "[]")) && (v = w.toArray(x)))
        return E = Jo(E), v.forEach(function(j, F) {
          !(w.isUndefined(j) || j === null) && e.append(
            // eslint-disable-next-line no-nested-ternary
            i === !0 ? Ja([E], F, a) : i === null ? E : E + "[]",
            f(j)
          );
        }), !1;
    }
    return hs(x) ? !0 : (e.append(Ja(g, E, a), f(x)), !1);
  }
  const m = [], h = Object.assign(rh, {
    defaultVisitor: d,
    convertValue: f,
    isVisitable: hs
  });
  function S(x, E) {
    if (!w.isUndefined(x)) {
      if (m.indexOf(x) !== -1)
        throw Error("Circular reference detected in " + E.join("."));
      m.push(x), w.forEach(x, function(v, b) {
        (!(w.isUndefined(v) || v === null) && s.call(
          e,
          v,
          w.isString(b) ? b.trim() : b,
          E,
          h
        )) === !0 && S(v, E ? E.concat(b) : [b]);
      }), m.pop();
    }
  }
  if (!w.isObject(t))
    throw new TypeError("data must be an object");
  return S(t), e;
}
function Qa(t) {
  const e = {
    "!": "%21",
    "'": "%27",
    "(": "%28",
    ")": "%29",
    "~": "%7E",
    "%20": "+",
    "%00": "\0"
  };
  return encodeURIComponent(t).replace(/[!'()~]|%20|%00/g, function(r) {
    return e[r];
  });
}
function Qs(t, e) {
  this._pairs = [], t && Cr(t, this, e);
}
const Qo = Qs.prototype;
Qo.append = function(e, n) {
  this._pairs.push([e, n]);
};
Qo.toString = function(e) {
  const n = e ? function(r) {
    return e.call(this, r, Qa);
  } : Qa;
  return this._pairs.map(function(s) {
    return n(s[0]) + "=" + n(s[1]);
  }, "").join("&");
};
function sh(t) {
  return encodeURIComponent(t).replace(/%3A/gi, ":").replace(/%24/g, "$").replace(/%2C/gi, ",").replace(/%20/g, "+").replace(/%5B/gi, "[").replace(/%5D/gi, "]");
}
function Xo(t, e, n) {
  if (!e)
    return t;
  const r = n && n.encode || sh;
  w.isFunction(n) && (n = {
    serialize: n
  });
  const s = n && n.serialize;
  let a;
  if (s ? a = s(e, n) : a = w.isURLSearchParams(e) ? e.toString() : new Qs(e, n).toString(r), a) {
    const i = t.indexOf("#");
    i !== -1 && (t = t.slice(0, i)), t += (t.indexOf("?") === -1 ? "?" : "&") + a;
  }
  return t;
}
class Xa {
  constructor() {
    this.handlers = [];
  }
  /**
   * Add a new interceptor to the stack
   *
   * @param {Function} fulfilled The function to handle `then` for a `Promise`
   * @param {Function} rejected The function to handle `reject` for a `Promise`
   *
   * @return {Number} An ID used to remove interceptor later
   */
  use(e, n, r) {
    return this.handlers.push({
      fulfilled: e,
      rejected: n,
      synchronous: r ? r.synchronous : !1,
      runWhen: r ? r.runWhen : null
    }), this.handlers.length - 1;
  }
  /**
   * Remove an interceptor from the stack
   *
   * @param {Number} id The ID that was returned by `use`
   *
   * @returns {Boolean} `true` if the interceptor was removed, `false` otherwise
   */
  eject(e) {
    this.handlers[e] && (this.handlers[e] = null);
  }
  /**
   * Clear all interceptors from the stack
   *
   * @returns {void}
   */
  clear() {
    this.handlers && (this.handlers = []);
  }
  /**
   * Iterate over all the registered interceptors
   *
   * This method is particularly useful for skipping over any
   * interceptors that may have become `null` calling `eject`.
   *
   * @param {Function} fn The function to call for each interceptor
   *
   * @returns {void}
   */
  forEach(e) {
    w.forEach(this.handlers, function(r) {
      r !== null && e(r);
    });
  }
}
const Zo = {
  silentJSONParsing: !0,
  forcedJSONParsing: !0,
  clarifyTimeoutError: !1
}, ah = typeof URLSearchParams < "u" ? URLSearchParams : Qs, ih = typeof FormData < "u" ? FormData : null, oh = typeof Blob < "u" ? Blob : null, lh = {
  isBrowser: !0,
  classes: {
    URLSearchParams: ah,
    FormData: ih,
    Blob: oh
  },
  protocols: ["http", "https", "file", "blob", "url", "data"]
}, Xs = typeof window < "u" && typeof document < "u", gs = typeof navigator == "object" && navigator || void 0, uh = Xs && (!gs || ["ReactNative", "NativeScript", "NS"].indexOf(gs.product) < 0), ch = typeof WorkerGlobalScope < "u" && // eslint-disable-next-line no-undef
self instanceof WorkerGlobalScope && typeof self.importScripts == "function", dh = Xs && window.location.href || "http://localhost", fh = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  hasBrowserEnv: Xs,
  hasStandardBrowserEnv: uh,
  hasStandardBrowserWebWorkerEnv: ch,
  navigator: gs,
  origin: dh
}, Symbol.toStringTag, { value: "Module" })), Ee = {
  ...fh,
  ...lh
};
function mh(t, e) {
  return Cr(t, new Ee.classes.URLSearchParams(), Object.assign({
    visitor: function(n, r, s, a) {
      return Ee.isNode && w.isBuffer(n) ? (this.append(r, n.toString("base64")), !1) : a.defaultVisitor.apply(this, arguments);
    }
  }, e));
}
function ph(t) {
  return w.matchAll(/\w+|\[(\w*)]/g, t).map((e) => e[0] === "[]" ? "" : e[1] || e[0]);
}
function hh(t) {
  const e = {}, n = Object.keys(t);
  let r;
  const s = n.length;
  let a;
  for (r = 0; r < s; r++)
    a = n[r], e[a] = t[a];
  return e;
}
function el(t) {
  function e(n, r, s, a) {
    let i = n[a++];
    if (i === "__proto__") return !0;
    const l = Number.isFinite(+i), u = a >= n.length;
    return i = !i && w.isArray(s) ? s.length : i, u ? (w.hasOwnProp(s, i) ? s[i] = [s[i], r] : s[i] = r, !l) : ((!s[i] || !w.isObject(s[i])) && (s[i] = []), e(n, r, s[i], a) && w.isArray(s[i]) && (s[i] = hh(s[i])), !l);
  }
  if (w.isFormData(t) && w.isFunction(t.entries)) {
    const n = {};
    return w.forEachEntry(t, (r, s) => {
      e(ph(r), s, n, 0);
    }), n;
  }
  return null;
}
function gh(t, e, n) {
  if (w.isString(t))
    try {
      return (e || JSON.parse)(t), w.trim(t);
    } catch (r) {
      if (r.name !== "SyntaxError")
        throw r;
    }
  return (n || JSON.stringify)(t);
}
const Hn = {
  transitional: Zo,
  adapter: ["xhr", "http", "fetch"],
  transformRequest: [function(e, n) {
    const r = n.getContentType() || "", s = r.indexOf("application/json") > -1, a = w.isObject(e);
    if (a && w.isHTMLForm(e) && (e = new FormData(e)), w.isFormData(e))
      return s ? JSON.stringify(el(e)) : e;
    if (w.isArrayBuffer(e) || w.isBuffer(e) || w.isStream(e) || w.isFile(e) || w.isBlob(e) || w.isReadableStream(e))
      return e;
    if (w.isArrayBufferView(e))
      return e.buffer;
    if (w.isURLSearchParams(e))
      return n.setContentType("application/x-www-form-urlencoded;charset=utf-8", !1), e.toString();
    let l;
    if (a) {
      if (r.indexOf("application/x-www-form-urlencoded") > -1)
        return mh(e, this.formSerializer).toString();
      if ((l = w.isFileList(e)) || r.indexOf("multipart/form-data") > -1) {
        const u = this.env && this.env.FormData;
        return Cr(
          l ? { "files[]": e } : e,
          u && new u(),
          this.formSerializer
        );
      }
    }
    return a || s ? (n.setContentType("application/json", !1), gh(e)) : e;
  }],
  transformResponse: [function(e) {
    const n = this.transitional || Hn.transitional, r = n && n.forcedJSONParsing, s = this.responseType === "json";
    if (w.isResponse(e) || w.isReadableStream(e))
      return e;
    if (e && w.isString(e) && (r && !this.responseType || s)) {
      const i = !(n && n.silentJSONParsing) && s;
      try {
        return JSON.parse(e);
      } catch (l) {
        if (i)
          throw l.name === "SyntaxError" ? W.from(l, W.ERR_BAD_RESPONSE, this, null, this.response) : l;
      }
    }
    return e;
  }],
  /**
   * A timeout in milliseconds to abort a request. If set to 0 (default) a
   * timeout is not created.
   */
  timeout: 0,
  xsrfCookieName: "XSRF-TOKEN",
  xsrfHeaderName: "X-XSRF-TOKEN",
  maxContentLength: -1,
  maxBodyLength: -1,
  env: {
    FormData: Ee.classes.FormData,
    Blob: Ee.classes.Blob
  },
  validateStatus: function(e) {
    return e >= 200 && e < 300;
  },
  headers: {
    common: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": void 0
    }
  }
};
w.forEach(["delete", "get", "head", "post", "put", "patch"], (t) => {
  Hn.headers[t] = {};
});
const xh = w.toObjectSet([
  "age",
  "authorization",
  "content-length",
  "content-type",
  "etag",
  "expires",
  "from",
  "host",
  "if-modified-since",
  "if-unmodified-since",
  "last-modified",
  "location",
  "max-forwards",
  "proxy-authorization",
  "referer",
  "retry-after",
  "user-agent"
]), bh = (t) => {
  const e = {};
  let n, r, s;
  return t && t.split(`
`).forEach(function(i) {
    s = i.indexOf(":"), n = i.substring(0, s).trim().toLowerCase(), r = i.substring(s + 1).trim(), !(!n || e[n] && xh[n]) && (n === "set-cookie" ? e[n] ? e[n].push(r) : e[n] = [r] : e[n] = e[n] ? e[n] + ", " + r : r);
  }), e;
}, Za = Symbol("internals");
function On(t) {
  return t && String(t).trim().toLowerCase();
}
function cr(t) {
  return t === !1 || t == null ? t : w.isArray(t) ? t.map(cr) : String(t);
}
function Nh(t) {
  const e = /* @__PURE__ */ Object.create(null), n = /([^\s,;=]+)\s*(?:=\s*([^,;]+))?/g;
  let r;
  for (; r = n.exec(t); )
    e[r[1]] = r[2];
  return e;
}
const vh = (t) => /^[-_a-zA-Z0-9^`|~,!#$%&'*+.]+$/.test(t.trim());
function Gr(t, e, n, r, s) {
  if (w.isFunction(r))
    return r.call(this, e, n);
  if (s && (e = n), !!w.isString(e)) {
    if (w.isString(r))
      return e.indexOf(r) !== -1;
    if (w.isRegExp(r))
      return r.test(e);
  }
}
function yh(t) {
  return t.trim().toLowerCase().replace(/([a-z\d])(\w*)/g, (e, n, r) => n.toUpperCase() + r);
}
function wh(t, e) {
  const n = w.toCamelCase(" " + e);
  ["get", "set", "has"].forEach((r) => {
    Object.defineProperty(t, r + n, {
      value: function(s, a, i) {
        return this[r].call(this, e, s, a, i);
      },
      configurable: !0
    });
  });
}
let Ie = class {
  constructor(e) {
    e && this.set(e);
  }
  set(e, n, r) {
    const s = this;
    function a(l, u, f) {
      const d = On(u);
      if (!d)
        throw new Error("header name must be a non-empty string");
      const m = w.findKey(s, d);
      (!m || s[m] === void 0 || f === !0 || f === void 0 && s[m] !== !1) && (s[m || u] = cr(l));
    }
    const i = (l, u) => w.forEach(l, (f, d) => a(f, d, u));
    if (w.isPlainObject(e) || e instanceof this.constructor)
      i(e, n);
    else if (w.isString(e) && (e = e.trim()) && !vh(e))
      i(bh(e), n);
    else if (w.isObject(e) && w.isIterable(e)) {
      let l = {}, u, f;
      for (const d of e) {
        if (!w.isArray(d))
          throw TypeError("Object iterator must return a key-value pair");
        l[f = d[0]] = (u = l[f]) ? w.isArray(u) ? [...u, d[1]] : [u, d[1]] : d[1];
      }
      i(l, n);
    } else
      e != null && a(n, e, r);
    return this;
  }
  get(e, n) {
    if (e = On(e), e) {
      const r = w.findKey(this, e);
      if (r) {
        const s = this[r];
        if (!n)
          return s;
        if (n === !0)
          return Nh(s);
        if (w.isFunction(n))
          return n.call(this, s, r);
        if (w.isRegExp(n))
          return n.exec(s);
        throw new TypeError("parser must be boolean|regexp|function");
      }
    }
  }
  has(e, n) {
    if (e = On(e), e) {
      const r = w.findKey(this, e);
      return !!(r && this[r] !== void 0 && (!n || Gr(this, this[r], r, n)));
    }
    return !1;
  }
  delete(e, n) {
    const r = this;
    let s = !1;
    function a(i) {
      if (i = On(i), i) {
        const l = w.findKey(r, i);
        l && (!n || Gr(r, r[l], l, n)) && (delete r[l], s = !0);
      }
    }
    return w.isArray(e) ? e.forEach(a) : a(e), s;
  }
  clear(e) {
    const n = Object.keys(this);
    let r = n.length, s = !1;
    for (; r--; ) {
      const a = n[r];
      (!e || Gr(this, this[a], a, e, !0)) && (delete this[a], s = !0);
    }
    return s;
  }
  normalize(e) {
    const n = this, r = {};
    return w.forEach(this, (s, a) => {
      const i = w.findKey(r, a);
      if (i) {
        n[i] = cr(s), delete n[a];
        return;
      }
      const l = e ? yh(a) : String(a).trim();
      l !== a && delete n[a], n[l] = cr(s), r[l] = !0;
    }), this;
  }
  concat(...e) {
    return this.constructor.concat(this, ...e);
  }
  toJSON(e) {
    const n = /* @__PURE__ */ Object.create(null);
    return w.forEach(this, (r, s) => {
      r != null && r !== !1 && (n[s] = e && w.isArray(r) ? r.join(", ") : r);
    }), n;
  }
  [Symbol.iterator]() {
    return Object.entries(this.toJSON())[Symbol.iterator]();
  }
  toString() {
    return Object.entries(this.toJSON()).map(([e, n]) => e + ": " + n).join(`
`);
  }
  getSetCookie() {
    return this.get("set-cookie") || [];
  }
  get [Symbol.toStringTag]() {
    return "AxiosHeaders";
  }
  static from(e) {
    return e instanceof this ? e : new this(e);
  }
  static concat(e, ...n) {
    const r = new this(e);
    return n.forEach((s) => r.set(s)), r;
  }
  static accessor(e) {
    const r = (this[Za] = this[Za] = {
      accessors: {}
    }).accessors, s = this.prototype;
    function a(i) {
      const l = On(i);
      r[l] || (wh(s, i), r[l] = !0);
    }
    return w.isArray(e) ? e.forEach(a) : a(e), this;
  }
};
Ie.accessor(["Content-Type", "Content-Length", "Accept", "Accept-Encoding", "User-Agent", "Authorization"]);
w.reduceDescriptors(Ie.prototype, ({ value: t }, e) => {
  let n = e[0].toUpperCase() + e.slice(1);
  return {
    get: () => t,
    set(r) {
      this[n] = r;
    }
  };
});
w.freezeMethods(Ie);
function Kr(t, e) {
  const n = this || Hn, r = e || n, s = Ie.from(r.headers);
  let a = r.data;
  return w.forEach(t, function(l) {
    a = l.call(n, a, s.normalize(), e ? e.status : void 0);
  }), s.normalize(), a;
}
function tl(t) {
  return !!(t && t.__CANCEL__);
}
function bn(t, e, n) {
  W.call(this, t ?? "canceled", W.ERR_CANCELED, e, n), this.name = "CanceledError";
}
w.inherits(bn, W, {
  __CANCEL__: !0
});
function nl(t, e, n) {
  const r = n.config.validateStatus;
  !n.status || !r || r(n.status) ? t(n) : e(new W(
    "Request failed with status code " + n.status,
    [W.ERR_BAD_REQUEST, W.ERR_BAD_RESPONSE][Math.floor(n.status / 100) - 4],
    n.config,
    n.request,
    n
  ));
}
function Eh(t) {
  const e = /^([-+\w]{1,25})(:?\/\/|:)/.exec(t);
  return e && e[1] || "";
}
function Sh(t, e) {
  t = t || 10;
  const n = new Array(t), r = new Array(t);
  let s = 0, a = 0, i;
  return e = e !== void 0 ? e : 1e3, function(u) {
    const f = Date.now(), d = r[a];
    i || (i = f), n[s] = u, r[s] = f;
    let m = a, h = 0;
    for (; m !== s; )
      h += n[m++], m = m % t;
    if (s = (s + 1) % t, s === a && (a = (a + 1) % t), f - i < e)
      return;
    const S = d && f - d;
    return S ? Math.round(h * 1e3 / S) : void 0;
  };
}
function Dh(t, e) {
  let n = 0, r = 1e3 / e, s, a;
  const i = (f, d = Date.now()) => {
    n = d, s = null, a && (clearTimeout(a), a = null), t.apply(null, f);
  };
  return [(...f) => {
    const d = Date.now(), m = d - n;
    m >= r ? i(f, d) : (s = f, a || (a = setTimeout(() => {
      a = null, i(s);
    }, r - m)));
  }, () => s && i(s)];
}
const xr = (t, e, n = 3) => {
  let r = 0;
  const s = Sh(50, 250);
  return Dh((a) => {
    const i = a.loaded, l = a.lengthComputable ? a.total : void 0, u = i - r, f = s(u), d = i <= l;
    r = i;
    const m = {
      loaded: i,
      total: l,
      progress: l ? i / l : void 0,
      bytes: u,
      rate: f || void 0,
      estimated: f && l && d ? (l - i) / f : void 0,
      event: a,
      lengthComputable: l != null,
      [e ? "download" : "upload"]: !0
    };
    t(m);
  }, n);
}, ei = (t, e) => {
  const n = t != null;
  return [(r) => e[0]({
    lengthComputable: n,
    total: t,
    loaded: r
  }), e[1]];
}, ti = (t) => (...e) => w.asap(() => t(...e)), Ah = Ee.hasStandardBrowserEnv ? /* @__PURE__ */ ((t, e) => (n) => (n = new URL(n, Ee.origin), t.protocol === n.protocol && t.host === n.host && (e || t.port === n.port)))(
  new URL(Ee.origin),
  Ee.navigator && /(msie|trident)/i.test(Ee.navigator.userAgent)
) : () => !0, jh = Ee.hasStandardBrowserEnv ? (
  // Standard browser envs support document.cookie
  {
    write(t, e, n, r, s, a) {
      const i = [t + "=" + encodeURIComponent(e)];
      w.isNumber(n) && i.push("expires=" + new Date(n).toGMTString()), w.isString(r) && i.push("path=" + r), w.isString(s) && i.push("domain=" + s), a === !0 && i.push("secure"), document.cookie = i.join("; ");
    },
    read(t) {
      const e = document.cookie.match(new RegExp("(^|;\\s*)(" + t + ")=([^;]*)"));
      return e ? decodeURIComponent(e[3]) : null;
    },
    remove(t) {
      this.write(t, "", Date.now() - 864e5);
    }
  }
) : (
  // Non-standard browser env (web workers, react-native) lack needed support.
  {
    write() {
    },
    read() {
      return null;
    },
    remove() {
    }
  }
);
function Th(t) {
  return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(t);
}
function _h(t, e) {
  return e ? t.replace(/\/?\/$/, "") + "/" + e.replace(/^\/+/, "") : t;
}
function rl(t, e, n) {
  let r = !Th(e);
  return t && (r || n == !1) ? _h(t, e) : e;
}
const ni = (t) => t instanceof Ie ? { ...t } : t;
function Ht(t, e) {
  e = e || {};
  const n = {};
  function r(f, d, m, h) {
    return w.isPlainObject(f) && w.isPlainObject(d) ? w.merge.call({ caseless: h }, f, d) : w.isPlainObject(d) ? w.merge({}, d) : w.isArray(d) ? d.slice() : d;
  }
  function s(f, d, m, h) {
    if (w.isUndefined(d)) {
      if (!w.isUndefined(f))
        return r(void 0, f, m, h);
    } else return r(f, d, m, h);
  }
  function a(f, d) {
    if (!w.isUndefined(d))
      return r(void 0, d);
  }
  function i(f, d) {
    if (w.isUndefined(d)) {
      if (!w.isUndefined(f))
        return r(void 0, f);
    } else return r(void 0, d);
  }
  function l(f, d, m) {
    if (m in e)
      return r(f, d);
    if (m in t)
      return r(void 0, f);
  }
  const u = {
    url: a,
    method: a,
    data: a,
    baseURL: i,
    transformRequest: i,
    transformResponse: i,
    paramsSerializer: i,
    timeout: i,
    timeoutMessage: i,
    withCredentials: i,
    withXSRFToken: i,
    adapter: i,
    responseType: i,
    xsrfCookieName: i,
    xsrfHeaderName: i,
    onUploadProgress: i,
    onDownloadProgress: i,
    decompress: i,
    maxContentLength: i,
    maxBodyLength: i,
    beforeRedirect: i,
    transport: i,
    httpAgent: i,
    httpsAgent: i,
    cancelToken: i,
    socketPath: i,
    responseEncoding: i,
    validateStatus: l,
    headers: (f, d, m) => s(ni(f), ni(d), m, !0)
  };
  return w.forEach(Object.keys(Object.assign({}, t, e)), function(d) {
    const m = u[d] || s, h = m(t[d], e[d], d);
    w.isUndefined(h) && m !== l || (n[d] = h);
  }), n;
}
const sl = (t) => {
  const e = Ht({}, t);
  let { data: n, withXSRFToken: r, xsrfHeaderName: s, xsrfCookieName: a, headers: i, auth: l } = e;
  e.headers = i = Ie.from(i), e.url = Xo(rl(e.baseURL, e.url, e.allowAbsoluteUrls), t.params, t.paramsSerializer), l && i.set(
    "Authorization",
    "Basic " + btoa((l.username || "") + ":" + (l.password ? unescape(encodeURIComponent(l.password)) : ""))
  );
  let u;
  if (w.isFormData(n)) {
    if (Ee.hasStandardBrowserEnv || Ee.hasStandardBrowserWebWorkerEnv)
      i.setContentType(void 0);
    else if ((u = i.getContentType()) !== !1) {
      const [f, ...d] = u ? u.split(";").map((m) => m.trim()).filter(Boolean) : [];
      i.setContentType([f || "multipart/form-data", ...d].join("; "));
    }
  }
  if (Ee.hasStandardBrowserEnv && (r && w.isFunction(r) && (r = r(e)), r || r !== !1 && Ah(e.url))) {
    const f = s && a && jh.read(a);
    f && i.set(s, f);
  }
  return e;
}, Rh = typeof XMLHttpRequest < "u", Oh = Rh && function(t) {
  return new Promise(function(n, r) {
    const s = sl(t);
    let a = s.data;
    const i = Ie.from(s.headers).normalize();
    let { responseType: l, onUploadProgress: u, onDownloadProgress: f } = s, d, m, h, S, x;
    function E() {
      S && S(), x && x(), s.cancelToken && s.cancelToken.unsubscribe(d), s.signal && s.signal.removeEventListener("abort", d);
    }
    let g = new XMLHttpRequest();
    g.open(s.method.toUpperCase(), s.url, !0), g.timeout = s.timeout;
    function v() {
      if (!g)
        return;
      const j = Ie.from(
        "getAllResponseHeaders" in g && g.getAllResponseHeaders()
      ), D = {
        data: !l || l === "text" || l === "json" ? g.responseText : g.response,
        status: g.status,
        statusText: g.statusText,
        headers: j,
        config: t,
        request: g
      };
      nl(function(k) {
        n(k), E();
      }, function(k) {
        r(k), E();
      }, D), g = null;
    }
    "onloadend" in g ? g.onloadend = v : g.onreadystatechange = function() {
      !g || g.readyState !== 4 || g.status === 0 && !(g.responseURL && g.responseURL.indexOf("file:") === 0) || setTimeout(v);
    }, g.onabort = function() {
      g && (r(new W("Request aborted", W.ECONNABORTED, t, g)), g = null);
    }, g.onerror = function() {
      r(new W("Network Error", W.ERR_NETWORK, t, g)), g = null;
    }, g.ontimeout = function() {
      let F = s.timeout ? "timeout of " + s.timeout + "ms exceeded" : "timeout exceeded";
      const D = s.transitional || Zo;
      s.timeoutErrorMessage && (F = s.timeoutErrorMessage), r(new W(
        F,
        D.clarifyTimeoutError ? W.ETIMEDOUT : W.ECONNABORTED,
        t,
        g
      )), g = null;
    }, a === void 0 && i.setContentType(null), "setRequestHeader" in g && w.forEach(i.toJSON(), function(F, D) {
      g.setRequestHeader(D, F);
    }), w.isUndefined(s.withCredentials) || (g.withCredentials = !!s.withCredentials), l && l !== "json" && (g.responseType = s.responseType), f && ([h, x] = xr(f, !0), g.addEventListener("progress", h)), u && g.upload && ([m, S] = xr(u), g.upload.addEventListener("progress", m), g.upload.addEventListener("loadend", S)), (s.cancelToken || s.signal) && (d = (j) => {
      g && (r(!j || j.type ? new bn(null, t, g) : j), g.abort(), g = null);
    }, s.cancelToken && s.cancelToken.subscribe(d), s.signal && (s.signal.aborted ? d() : s.signal.addEventListener("abort", d)));
    const b = Eh(s.url);
    if (b && Ee.protocols.indexOf(b) === -1) {
      r(new W("Unsupported protocol " + b + ":", W.ERR_BAD_REQUEST, t));
      return;
    }
    g.send(a || null);
  });
}, Ch = (t, e) => {
  const { length: n } = t = t ? t.filter(Boolean) : [];
  if (e || n) {
    let r = new AbortController(), s;
    const a = function(f) {
      if (!s) {
        s = !0, l();
        const d = f instanceof Error ? f : this.reason;
        r.abort(d instanceof W ? d : new bn(d instanceof Error ? d.message : d));
      }
    };
    let i = e && setTimeout(() => {
      i = null, a(new W(`timeout ${e} of ms exceeded`, W.ETIMEDOUT));
    }, e);
    const l = () => {
      t && (i && clearTimeout(i), i = null, t.forEach((f) => {
        f.unsubscribe ? f.unsubscribe(a) : f.removeEventListener("abort", a);
      }), t = null);
    };
    t.forEach((f) => f.addEventListener("abort", a));
    const { signal: u } = r;
    return u.unsubscribe = () => w.asap(l), u;
  }
}, Vh = function* (t, e) {
  let n = t.byteLength;
  if (n < e) {
    yield t;
    return;
  }
  let r = 0, s;
  for (; r < n; )
    s = r + e, yield t.slice(r, s), r = s;
}, Fh = async function* (t, e) {
  for await (const n of Ph(t))
    yield* Vh(n, e);
}, Ph = async function* (t) {
  if (t[Symbol.asyncIterator]) {
    yield* t;
    return;
  }
  const e = t.getReader();
  try {
    for (; ; ) {
      const { done: n, value: r } = await e.read();
      if (n)
        break;
      yield r;
    }
  } finally {
    await e.cancel();
  }
}, ri = (t, e, n, r) => {
  const s = Fh(t, e);
  let a = 0, i, l = (u) => {
    i || (i = !0, r && r(u));
  };
  return new ReadableStream({
    async pull(u) {
      try {
        const { done: f, value: d } = await s.next();
        if (f) {
          l(), u.close();
          return;
        }
        let m = d.byteLength;
        if (n) {
          let h = a += m;
          n(h);
        }
        u.enqueue(new Uint8Array(d));
      } catch (f) {
        throw l(f), f;
      }
    },
    cancel(u) {
      return l(u), s.return();
    }
  }, {
    highWaterMark: 2
  });
}, Vr = typeof fetch == "function" && typeof Request == "function" && typeof Response == "function", al = Vr && typeof ReadableStream == "function", Ih = Vr && (typeof TextEncoder == "function" ? /* @__PURE__ */ ((t) => (e) => t.encode(e))(new TextEncoder()) : async (t) => new Uint8Array(await new Response(t).arrayBuffer())), il = (t, ...e) => {
  try {
    return !!t(...e);
  } catch {
    return !1;
  }
}, $h = al && il(() => {
  let t = !1;
  const e = new Request(Ee.origin, {
    body: new ReadableStream(),
    method: "POST",
    get duplex() {
      return t = !0, "half";
    }
  }).headers.has("Content-Type");
  return t && !e;
}), si = 64 * 1024, xs = al && il(() => w.isReadableStream(new Response("").body)), br = {
  stream: xs && ((t) => t.body)
};
Vr && ((t) => {
  ["text", "arrayBuffer", "blob", "formData", "stream"].forEach((e) => {
    !br[e] && (br[e] = w.isFunction(t[e]) ? (n) => n[e]() : (n, r) => {
      throw new W(`Response type '${e}' is not supported`, W.ERR_NOT_SUPPORT, r);
    });
  });
})(new Response());
const kh = async (t) => {
  if (t == null)
    return 0;
  if (w.isBlob(t))
    return t.size;
  if (w.isSpecCompliantForm(t))
    return (await new Request(Ee.origin, {
      method: "POST",
      body: t
    }).arrayBuffer()).byteLength;
  if (w.isArrayBufferView(t) || w.isArrayBuffer(t))
    return t.byteLength;
  if (w.isURLSearchParams(t) && (t = t + ""), w.isString(t))
    return (await Ih(t)).byteLength;
}, Lh = async (t, e) => {
  const n = w.toFiniteNumber(t.getContentLength());
  return n ?? kh(e);
}, Mh = Vr && (async (t) => {
  let {
    url: e,
    method: n,
    data: r,
    signal: s,
    cancelToken: a,
    timeout: i,
    onDownloadProgress: l,
    onUploadProgress: u,
    responseType: f,
    headers: d,
    withCredentials: m = "same-origin",
    fetchOptions: h
  } = sl(t);
  f = f ? (f + "").toLowerCase() : "text";
  let S = Ch([s, a && a.toAbortSignal()], i), x;
  const E = S && S.unsubscribe && (() => {
    S.unsubscribe();
  });
  let g;
  try {
    if (u && $h && n !== "get" && n !== "head" && (g = await Lh(d, r)) !== 0) {
      let D = new Request(e, {
        method: "POST",
        body: r,
        duplex: "half"
      }), R;
      if (w.isFormData(r) && (R = D.headers.get("content-type")) && d.setContentType(R), D.body) {
        const [k, Y] = ei(
          g,
          xr(ti(u))
        );
        r = ri(D.body, si, k, Y);
      }
    }
    w.isString(m) || (m = m ? "include" : "omit");
    const v = "credentials" in Request.prototype;
    x = new Request(e, {
      ...h,
      signal: S,
      method: n.toUpperCase(),
      headers: d.normalize().toJSON(),
      body: r,
      duplex: "half",
      credentials: v ? m : void 0
    });
    let b = await fetch(x);
    const j = xs && (f === "stream" || f === "response");
    if (xs && (l || j && E)) {
      const D = {};
      ["status", "statusText", "headers"].forEach((ue) => {
        D[ue] = b[ue];
      });
      const R = w.toFiniteNumber(b.headers.get("content-length")), [k, Y] = l && ei(
        R,
        xr(ti(l), !0)
      ) || [];
      b = new Response(
        ri(b.body, si, k, () => {
          Y && Y(), E && E();
        }),
        D
      );
    }
    f = f || "text";
    let F = await br[w.findKey(br, f) || "text"](b, t);
    return !j && E && E(), await new Promise((D, R) => {
      nl(D, R, {
        data: F,
        headers: Ie.from(b.headers),
        status: b.status,
        statusText: b.statusText,
        config: t,
        request: x
      });
    });
  } catch (v) {
    throw E && E(), v && v.name === "TypeError" && /Load failed|fetch/i.test(v.message) ? Object.assign(
      new W("Network Error", W.ERR_NETWORK, t, x),
      {
        cause: v.cause || v
      }
    ) : W.from(v, v && v.code, t, x);
  }
}), bs = {
  http: th,
  xhr: Oh,
  fetch: Mh
};
w.forEach(bs, (t, e) => {
  if (t) {
    try {
      Object.defineProperty(t, "name", { value: e });
    } catch {
    }
    Object.defineProperty(t, "adapterName", { value: e });
  }
});
const ai = (t) => `- ${t}`, Uh = (t) => w.isFunction(t) || t === null || t === !1, ol = {
  getAdapter: (t) => {
    t = w.isArray(t) ? t : [t];
    const { length: e } = t;
    let n, r;
    const s = {};
    for (let a = 0; a < e; a++) {
      n = t[a];
      let i;
      if (r = n, !Uh(n) && (r = bs[(i = String(n)).toLowerCase()], r === void 0))
        throw new W(`Unknown adapter '${i}'`);
      if (r)
        break;
      s[i || "#" + a] = r;
    }
    if (!r) {
      const a = Object.entries(s).map(
        ([l, u]) => `adapter ${l} ` + (u === !1 ? "is not supported by the environment" : "is not available in the build")
      );
      let i = e ? a.length > 1 ? `since :
` + a.map(ai).join(`
`) : " " + ai(a[0]) : "as no adapter specified";
      throw new W(
        "There is no suitable adapter to dispatch the request " + i,
        "ERR_NOT_SUPPORT"
      );
    }
    return r;
  },
  adapters: bs
};
function Jr(t) {
  if (t.cancelToken && t.cancelToken.throwIfRequested(), t.signal && t.signal.aborted)
    throw new bn(null, t);
}
function ii(t) {
  return Jr(t), t.headers = Ie.from(t.headers), t.data = Kr.call(
    t,
    t.transformRequest
  ), ["post", "put", "patch"].indexOf(t.method) !== -1 && t.headers.setContentType("application/x-www-form-urlencoded", !1), ol.getAdapter(t.adapter || Hn.adapter)(t).then(function(r) {
    return Jr(t), r.data = Kr.call(
      t,
      t.transformResponse,
      r
    ), r.headers = Ie.from(r.headers), r;
  }, function(r) {
    return tl(r) || (Jr(t), r && r.response && (r.response.data = Kr.call(
      t,
      t.transformResponse,
      r.response
    ), r.response.headers = Ie.from(r.response.headers))), Promise.reject(r);
  });
}
const ll = "1.9.0", Fr = {};
["object", "boolean", "number", "function", "string", "symbol"].forEach((t, e) => {
  Fr[t] = function(r) {
    return typeof r === t || "a" + (e < 1 ? "n " : " ") + t;
  };
});
const oi = {};
Fr.transitional = function(e, n, r) {
  function s(a, i) {
    return "[Axios v" + ll + "] Transitional option '" + a + "'" + i + (r ? ". " + r : "");
  }
  return (a, i, l) => {
    if (e === !1)
      throw new W(
        s(i, " has been removed" + (n ? " in " + n : "")),
        W.ERR_DEPRECATED
      );
    return n && !oi[i] && (oi[i] = !0, console.warn(
      s(
        i,
        " has been deprecated since v" + n + " and will be removed in the near future"
      )
    )), e ? e(a, i, l) : !0;
  };
};
Fr.spelling = function(e) {
  return (n, r) => (console.warn(`${r} is likely a misspelling of ${e}`), !0);
};
function Bh(t, e, n) {
  if (typeof t != "object")
    throw new W("options must be an object", W.ERR_BAD_OPTION_VALUE);
  const r = Object.keys(t);
  let s = r.length;
  for (; s-- > 0; ) {
    const a = r[s], i = e[a];
    if (i) {
      const l = t[a], u = l === void 0 || i(l, a, t);
      if (u !== !0)
        throw new W("option " + a + " must be " + u, W.ERR_BAD_OPTION_VALUE);
      continue;
    }
    if (n !== !0)
      throw new W("Unknown option " + a, W.ERR_BAD_OPTION);
  }
}
const dr = {
  assertOptions: Bh,
  validators: Fr
}, it = dr.validators;
let Wt = class {
  constructor(e) {
    this.defaults = e || {}, this.interceptors = {
      request: new Xa(),
      response: new Xa()
    };
  }
  /**
   * Dispatch a request
   *
   * @param {String|Object} configOrUrl The config specific for this request (merged with this.defaults)
   * @param {?Object} config
   *
   * @returns {Promise} The Promise to be fulfilled
   */
  async request(e, n) {
    try {
      return await this._request(e, n);
    } catch (r) {
      if (r instanceof Error) {
        let s = {};
        Error.captureStackTrace ? Error.captureStackTrace(s) : s = new Error();
        const a = s.stack ? s.stack.replace(/^.+\n/, "") : "";
        try {
          r.stack ? a && !String(r.stack).endsWith(a.replace(/^.+\n.+\n/, "")) && (r.stack += `
` + a) : r.stack = a;
        } catch {
        }
      }
      throw r;
    }
  }
  _request(e, n) {
    typeof e == "string" ? (n = n || {}, n.url = e) : n = e || {}, n = Ht(this.defaults, n);
    const { transitional: r, paramsSerializer: s, headers: a } = n;
    r !== void 0 && dr.assertOptions(r, {
      silentJSONParsing: it.transitional(it.boolean),
      forcedJSONParsing: it.transitional(it.boolean),
      clarifyTimeoutError: it.transitional(it.boolean)
    }, !1), s != null && (w.isFunction(s) ? n.paramsSerializer = {
      serialize: s
    } : dr.assertOptions(s, {
      encode: it.function,
      serialize: it.function
    }, !0)), n.allowAbsoluteUrls !== void 0 || (this.defaults.allowAbsoluteUrls !== void 0 ? n.allowAbsoluteUrls = this.defaults.allowAbsoluteUrls : n.allowAbsoluteUrls = !0), dr.assertOptions(n, {
      baseUrl: it.spelling("baseURL"),
      withXsrfToken: it.spelling("withXSRFToken")
    }, !0), n.method = (n.method || this.defaults.method || "get").toLowerCase();
    let i = a && w.merge(
      a.common,
      a[n.method]
    );
    a && w.forEach(
      ["delete", "get", "head", "post", "put", "patch", "common"],
      (x) => {
        delete a[x];
      }
    ), n.headers = Ie.concat(i, a);
    const l = [];
    let u = !0;
    this.interceptors.request.forEach(function(E) {
      typeof E.runWhen == "function" && E.runWhen(n) === !1 || (u = u && E.synchronous, l.unshift(E.fulfilled, E.rejected));
    });
    const f = [];
    this.interceptors.response.forEach(function(E) {
      f.push(E.fulfilled, E.rejected);
    });
    let d, m = 0, h;
    if (!u) {
      const x = [ii.bind(this), void 0];
      for (x.unshift.apply(x, l), x.push.apply(x, f), h = x.length, d = Promise.resolve(n); m < h; )
        d = d.then(x[m++], x[m++]);
      return d;
    }
    h = l.length;
    let S = n;
    for (m = 0; m < h; ) {
      const x = l[m++], E = l[m++];
      try {
        S = x(S);
      } catch (g) {
        E.call(this, g);
        break;
      }
    }
    try {
      d = ii.call(this, S);
    } catch (x) {
      return Promise.reject(x);
    }
    for (m = 0, h = f.length; m < h; )
      d = d.then(f[m++], f[m++]);
    return d;
  }
  getUri(e) {
    e = Ht(this.defaults, e);
    const n = rl(e.baseURL, e.url, e.allowAbsoluteUrls);
    return Xo(n, e.params, e.paramsSerializer);
  }
};
w.forEach(["delete", "get", "head", "options"], function(e) {
  Wt.prototype[e] = function(n, r) {
    return this.request(Ht(r || {}, {
      method: e,
      url: n,
      data: (r || {}).data
    }));
  };
});
w.forEach(["post", "put", "patch"], function(e) {
  function n(r) {
    return function(a, i, l) {
      return this.request(Ht(l || {}, {
        method: e,
        headers: r ? {
          "Content-Type": "multipart/form-data"
        } : {},
        url: a,
        data: i
      }));
    };
  }
  Wt.prototype[e] = n(), Wt.prototype[e + "Form"] = n(!0);
});
let zh = class ul {
  constructor(e) {
    if (typeof e != "function")
      throw new TypeError("executor must be a function.");
    let n;
    this.promise = new Promise(function(a) {
      n = a;
    });
    const r = this;
    this.promise.then((s) => {
      if (!r._listeners) return;
      let a = r._listeners.length;
      for (; a-- > 0; )
        r._listeners[a](s);
      r._listeners = null;
    }), this.promise.then = (s) => {
      let a;
      const i = new Promise((l) => {
        r.subscribe(l), a = l;
      }).then(s);
      return i.cancel = function() {
        r.unsubscribe(a);
      }, i;
    }, e(function(a, i, l) {
      r.reason || (r.reason = new bn(a, i, l), n(r.reason));
    });
  }
  /**
   * Throws a `CanceledError` if cancellation has been requested.
   */
  throwIfRequested() {
    if (this.reason)
      throw this.reason;
  }
  /**
   * Subscribe to the cancel signal
   */
  subscribe(e) {
    if (this.reason) {
      e(this.reason);
      return;
    }
    this._listeners ? this._listeners.push(e) : this._listeners = [e];
  }
  /**
   * Unsubscribe from the cancel signal
   */
  unsubscribe(e) {
    if (!this._listeners)
      return;
    const n = this._listeners.indexOf(e);
    n !== -1 && this._listeners.splice(n, 1);
  }
  toAbortSignal() {
    const e = new AbortController(), n = (r) => {
      e.abort(r);
    };
    return this.subscribe(n), e.signal.unsubscribe = () => this.unsubscribe(n), e.signal;
  }
  /**
   * Returns an object that contains a new `CancelToken` and a function that, when called,
   * cancels the `CancelToken`.
   */
  static source() {
    let e;
    return {
      token: new ul(function(s) {
        e = s;
      }),
      cancel: e
    };
  }
};
function qh(t) {
  return function(n) {
    return t.apply(null, n);
  };
}
function Wh(t) {
  return w.isObject(t) && t.isAxiosError === !0;
}
const Ns = {
  Continue: 100,
  SwitchingProtocols: 101,
  Processing: 102,
  EarlyHints: 103,
  Ok: 200,
  Created: 201,
  Accepted: 202,
  NonAuthoritativeInformation: 203,
  NoContent: 204,
  ResetContent: 205,
  PartialContent: 206,
  MultiStatus: 207,
  AlreadyReported: 208,
  ImUsed: 226,
  MultipleChoices: 300,
  MovedPermanently: 301,
  Found: 302,
  SeeOther: 303,
  NotModified: 304,
  UseProxy: 305,
  Unused: 306,
  TemporaryRedirect: 307,
  PermanentRedirect: 308,
  BadRequest: 400,
  Unauthorized: 401,
  PaymentRequired: 402,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  NotAcceptable: 406,
  ProxyAuthenticationRequired: 407,
  RequestTimeout: 408,
  Conflict: 409,
  Gone: 410,
  LengthRequired: 411,
  PreconditionFailed: 412,
  PayloadTooLarge: 413,
  UriTooLong: 414,
  UnsupportedMediaType: 415,
  RangeNotSatisfiable: 416,
  ExpectationFailed: 417,
  ImATeapot: 418,
  MisdirectedRequest: 421,
  UnprocessableEntity: 422,
  Locked: 423,
  FailedDependency: 424,
  TooEarly: 425,
  UpgradeRequired: 426,
  PreconditionRequired: 428,
  TooManyRequests: 429,
  RequestHeaderFieldsTooLarge: 431,
  UnavailableForLegalReasons: 451,
  InternalServerError: 500,
  NotImplemented: 501,
  BadGateway: 502,
  ServiceUnavailable: 503,
  GatewayTimeout: 504,
  HttpVersionNotSupported: 505,
  VariantAlsoNegotiates: 506,
  InsufficientStorage: 507,
  LoopDetected: 508,
  NotExtended: 510,
  NetworkAuthenticationRequired: 511
};
Object.entries(Ns).forEach(([t, e]) => {
  Ns[e] = t;
});
function cl(t) {
  const e = new Wt(t), n = Mo(Wt.prototype.request, e);
  return w.extend(n, Wt.prototype, e, { allOwnKeys: !0 }), w.extend(n, e, null, { allOwnKeys: !0 }), n.create = function(s) {
    return cl(Ht(t, s));
  }, n;
}
const pe = cl(Hn);
pe.Axios = Wt;
pe.CanceledError = bn;
pe.CancelToken = zh;
pe.isCancel = tl;
pe.VERSION = ll;
pe.toFormData = Cr;
pe.AxiosError = W;
pe.Cancel = pe.CanceledError;
pe.all = function(e) {
  return Promise.all(e);
};
pe.spread = qh;
pe.isAxiosError = Wh;
pe.mergeConfig = Ht;
pe.AxiosHeaders = Ie;
pe.formToJSON = (t) => el(w.isHTMLForm(t) ? new FormData(t) : t);
pe.getAdapter = ol.getAdapter;
pe.HttpStatusCode = Ns;
pe.default = pe;
const {
  Axios: Rg,
  AxiosError: Og,
  CanceledError: Cg,
  isCancel: Vg,
  CancelToken: Fg,
  VERSION: Pg,
  all: Ig,
  Cancel: $g,
  isAxiosError: kg,
  spread: Lg,
  toFormData: Mg,
  AxiosHeaders: Ug,
  HttpStatusCode: Bg,
  formToJSON: zg,
  getAdapter: qg,
  mergeConfig: Wg
} = pe;
class Yh extends Error {
  constructor(e, n, r) {
    super(e), this.statusCode = n, this.details = r, this.name = "SoftwareOneAPIError";
  }
}
class Zs {
  constructor(e) {
    this.client = pe.create({
      baseURL: e.apiEndpoint,
      headers: {
        Authorization: `Bearer ${e.apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      timeout: 3e4
      // 30 seconds
    }), this.setupInterceptors();
  }
  setupInterceptors() {
    this.client.interceptors.request.use(
      (e) => {
        const n = {
          ...e,
          headers: {
            ...e.headers,
            Authorization: "Bearer [REDACTED]"
          }
        };
        return console.debug("SoftwareOne API Request:", n), e;
      },
      (e) => (console.error("SoftwareOne API Request Error:", e), Promise.reject(e))
    ), this.client.interceptors.response.use(
      (e) => (console.debug("SoftwareOne API Response:", {
        status: e.status,
        url: e.config.url
      }), e),
      async (e) => {
        var r, s, a, i, l;
        if (((r = e.response) == null ? void 0 : r.status) === 429) {
          const u = e.response.headers["retry-after"] || 60;
          return console.warn(`Rate limited. Retrying after ${u} seconds`), await this.delay(parseInt(u.toString()) * 1e3), this.client.request(e.config);
        }
        const n = new Yh(
          ((a = (s = e.response) == null ? void 0 : s.data) == null ? void 0 : a.message) || e.message,
          (i = e.response) == null ? void 0 : i.status,
          (l = e.response) == null ? void 0 : l.data
        );
        throw console.error("SoftwareOne API Error:", n), n;
      }
    );
  }
  delay(e) {
    return new Promise((n) => setTimeout(n, e));
  }
  // Agreements endpoints
  async getAgreements(e) {
    const n = await this.client.get("/agreements", { params: e });
    return this.mapAgreements(n.data.items || n.data);
  }
  async getAgreement(e) {
    const n = await this.client.get(`/agreements/${e}`);
    return this.mapAgreement(n.data);
  }
  async activateAgreement(e) {
    const n = await this.client.patch(`/agreements/${e}/activate`);
    return this.mapAgreement(n.data);
  }
  // Subscriptions endpoints
  async getSubscriptions(e) {
    const n = await this.client.get(`/agreements/${e}/subscriptions`);
    return n.data.items || n.data;
  }
  // Orders endpoints
  async getOrders(e) {
    const n = await this.client.get(`/agreements/${e}/orders`);
    return n.data.items || n.data;
  }
  // Statements endpoints
  async getStatements(e) {
    const n = await this.client.get("/statements", { params: e });
    return n.data.items || n.data;
  }
  async getStatement(e) {
    return (await this.client.get(`/statements/${e}`)).data;
  }
  // Consumers endpoints
  async getConsumers() {
    const e = await this.client.get("/consumers");
    return e.data.items || e.data;
  }
  async getConsumer(e) {
    return (await this.client.get(`/consumers/${e}`)).data;
  }
  // Test connection
  async testConnection() {
    try {
      return await this.client.get("/health"), !0;
    } catch {
      try {
        return await this.client.get("/agreements?limit=1"), !0;
      } catch {
        return !1;
      }
    }
  }
  // Data mapping functions
  mapAgreements(e) {
    return e.map((n) => this.mapAgreement(n));
  }
  mapAgreement(e) {
    return {
      id: e.agreementId || e.id,
      name: e.agreementName || e.name,
      product: e.productName || e.product,
      vendor: e.vendorName || e.vendor,
      billingConfigId: e.billingConfigId,
      currency: e.contractCurrency || e.currency,
      spxYear: e.spxYear || 0,
      marginRpxy: e.marginRpxy || 0,
      consumer: e.consumerId || e.consumer,
      operations: this.mapOperationsVisibility(e.opsVisibility),
      status: this.mapStatus(e.status),
      createdAt: e.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: e.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  mapOperationsVisibility(e) {
    return {
      VISIBLE: "visible",
      HIDDEN: "hidden",
      RESTRICTED: "restricted"
    }[e] || "visible";
  }
  mapStatus(e) {
    return {
      ACTIVE: "active",
      INACTIVE: "inactive",
      PENDING: "pending",
      EXPIRED: "expired"
    }[e] || "inactive";
  }
}
const Oe = 15 * 60, Hh = "swone";
class Gn {
  constructor(e, n) {
    this.client = new Zs(e), this.storage = n.storage.getNamespace(Hh), this.logger = n.logger;
  }
  /**
   * Perform a full sync of all data from SoftwareOne
   */
  async performFullSync() {
    this.logger.info("Starting full SoftwareOne sync");
    const e = [], n = {
      agreements: 0,
      statements: 0,
      subscriptions: 0,
      orders: 0
    };
    try {
      const r = await this.syncAgreements();
      n.agreements = r.length;
      const s = await this.syncStatements();
      n.statements = s.length;
      for (const a of r)
        try {
          const i = await this.syncSubscriptions(a.id);
          n.subscriptions += i.length;
          const l = await this.syncOrders(a.id);
          n.orders += l.length;
        } catch (i) {
          const l = `Failed to sync data for agreement ${a.id}: ${i instanceof Error ? i.message : "Unknown error"}`;
          e.push(l), this.logger.error(l, i);
        }
      return await this.storage.set("sync/lastSync", {
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        counts: n,
        errors: e
      }, Oe), this.logger.info("SoftwareOne sync completed", { counts: n, errorCount: e.length }), {
        success: e.length === 0,
        message: e.length === 0 ? "Sync completed successfully" : `Sync completed with ${e.length} errors`,
        counts: n,
        errors: e.length > 0 ? e : void 0
      };
    } catch (r) {
      const s = `Full sync failed: ${r instanceof Error ? r.message : "Unknown error"}`;
      return this.logger.error(s, r), {
        success: !1,
        message: s,
        errors: [s]
      };
    }
  }
  /**
   * Sync agreements from SoftwareOne
   */
  async syncAgreements() {
    try {
      this.logger.info("Syncing agreements");
      const e = await this.fetchAllAgreements();
      await this.storage.set("raw/agreements", e, Oe), await this.storage.set("agreements", e, Oe);
      const n = new Map(e.map((s) => [s.id, s]));
      await this.storage.set("agreements/byId", Object.fromEntries(n), Oe);
      const r = this.groupBy(e, "status");
      return await this.storage.set("agreements/byStatus", r, Oe), this.logger.info(`Synced ${e.length} agreements`), e;
    } catch (e) {
      throw this.logger.error("Failed to sync agreements", e), e;
    }
  }
  /**
   * Sync statements from SoftwareOne
   */
  async syncStatements() {
    try {
      this.logger.info("Syncing statements");
      const e = /* @__PURE__ */ new Date();
      e.setDate(e.getDate() - 90);
      const n = await this.fetchAllStatements({
        dateFrom: e.toISOString().split("T")[0]
      });
      await this.storage.set("raw/statements", n, Oe), await this.storage.set("statements", n, Oe);
      const r = new Map(n.map((a) => [a.id, a]));
      await this.storage.set("statements/byId", Object.fromEntries(r), Oe);
      const s = this.groupBy(n, "status");
      return await this.storage.set("statements/byStatus", s, Oe), this.logger.info(`Synced ${n.length} statements`), n;
    } catch (e) {
      throw this.logger.error("Failed to sync statements", e), e;
    }
  }
  /**
   * Sync subscriptions for a specific agreement
   */
  async syncSubscriptions(e) {
    try {
      const n = await this.client.getSubscriptions(e);
      return await this.storage.set(`subscriptions/agreement/${e}`, n, Oe), n;
    } catch (n) {
      throw this.logger.error(`Failed to sync subscriptions for agreement ${e}`, n), n;
    }
  }
  /**
   * Sync orders for a specific agreement
   */
  async syncOrders(e) {
    try {
      const n = await this.client.getOrders(e);
      return await this.storage.set(`orders/agreement/${e}`, n, Oe), n;
    } catch (n) {
      throw this.logger.error(`Failed to sync orders for agreement ${e}`, n), n;
    }
  }
  /**
   * Fetch all agreements with pagination
   */
  async fetchAllAgreements() {
    const e = [];
    let n = 1;
    const r = 100;
    for (; ; ) {
      const s = await this.client.getAgreements({ page: n, limit: r });
      if (e.push(...s), s.length < r)
        break;
      n++;
    }
    return e;
  }
  /**
   * Fetch all statements with pagination
   */
  async fetchAllStatements(e = {}) {
    const n = [];
    let r = 1;
    const s = 100;
    for (; ; ) {
      const a = await this.client.getStatements({ page: r, limit: s, ...e });
      if (n.push(...a), a.length < s)
        break;
      r++;
    }
    return n;
  }
  /**
   * Refresh data for a specific agreement
   */
  async refreshAgreement(e) {
    try {
      const n = await this.client.getAgreement(e), r = await this.storage.get("agreements") || [], s = r.findIndex((i) => i.id === e);
      s >= 0 ? r[s] = n : r.push(n), await this.storage.set("agreements", r, Oe);
      const a = await this.storage.get("agreements/byId") || {};
      return a[e] = n, await this.storage.set("agreements/byId", a, Oe), await this.syncSubscriptions(e), await this.syncOrders(e), n;
    } catch (n) {
      throw this.logger.error(`Failed to refresh agreement ${e}`, n), n;
    }
  }
  /**
   * Get cached data or fetch if expired
   */
  async getCachedOrFetch(e, n, r = Oe) {
    try {
      const a = await this.storage.get(e);
      if (a)
        return a;
    } catch (a) {
      this.logger.warn(`Failed to get cached data for ${e}`, a);
    }
    const s = await n();
    return await this.storage.set(e, s, r), s;
  }
  /**
   * Utility to group array by property
   */
  groupBy(e, n) {
    return e.reduce((r, s) => {
      const a = String(s[n]);
      return r[a] || (r[a] = []), r[a].push(s), r;
    }, {});
  }
}
const Gh = xo({
  apiEndpoint: cs().url("Must be a valid URL").required("API endpoint is required"),
  apiToken: cs().required("API token is required").min(10, "API token must be at least 10 characters"),
  syncInterval: po().min(15, "Minimum sync interval is 15 minutes").max(1440, "Maximum sync interval is 24 hours").required("Sync interval is required"),
  enableAutoSync: co()
}), Yg = ({ context: t }) => {
  const { storage: e, logger: n } = t, [r, s] = Ae(null), [a, i] = Ae(!0), [l, u] = Ae(null), [f, d] = Ae(null), [m, h] = Ae(null);
  Ye(() => {
    S();
  }, []);
  const S = async () => {
    try {
      const v = await e.getNamespace("swone").get("config");
      s(v || {
        apiEndpoint: "https://api.softwareone.com",
        apiToken: "",
        syncInterval: 60,
        enableAutoSync: !1
      });
      const b = await e.getNamespace("swone").get("sync/lastSync");
      h(b);
    } catch (v) {
      n.error("Failed to load configuration", v);
    } finally {
      i(!1);
    }
  }, x = async (v) => {
    try {
      return await e.getNamespace("swone").set("config", v), s(v), n.info("Configuration saved successfully"), { success: !0, message: "Configuration saved successfully" };
    } catch (b) {
      throw n.error("Failed to save configuration", b), new Error("Failed to save configuration");
    }
  }, E = async () => {
    if (r) {
      u(null);
      try {
        const b = await new Zs(r).testConnection();
        u({
          success: b,
          message: b ? "Connection successful!" : "Connection failed. Please check your credentials."
        });
      } catch (v) {
        u({
          success: !1,
          message: `Connection failed: ${v instanceof Error ? v.message : "Unknown error"}`
        });
      }
    }
  }, g = async () => {
    if (r) {
      d(null);
      try {
        const b = await new Gn(r, t).performFullSync();
        d(b);
        const j = await e.getNamespace("swone").get("sync/lastSync");
        h(j);
      } catch (v) {
        d({
          success: !1,
          message: `Sync failed: ${v instanceof Error ? v.message : "Unknown error"}`,
          errors: [v instanceof Error ? v.message : "Unknown error"]
        });
      }
    }
  };
  return a ? /* @__PURE__ */ o.jsxDEV("div", { children: "Loading..." }, void 0, !1, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
    lineNumber: 122,
    columnNumber: 12
  }, void 0) : /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: [
    /* @__PURE__ */ o.jsxDEV("h1", { className: "text-2xl font-bold mb-6", children: "SoftwareOne Integration Settings" }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
      lineNumber: 127,
      columnNumber: 7
    }, void 0),
    /* @__PURE__ */ o.jsxDEV(Gs, { defaultValue: "connection", className: "w-full", children: [
      /* @__PURE__ */ o.jsxDEV(Ks, { className: "flex border-b mb-6", children: [
        /* @__PURE__ */ o.jsxDEV(He, { value: "connection", className: "px-4 py-2 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: "Connection" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
          lineNumber: 131,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(He, { value: "sync", className: "px-4 py-2 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: "Synchronization" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
          lineNumber: 134,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(He, { value: "advanced", className: "px-4 py-2 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: "Advanced" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
          lineNumber: 137,
          columnNumber: 11
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
        lineNumber: 130,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "connection", children: /* @__PURE__ */ o.jsxDEV(
        If,
        {
          initialValues: r || {
            apiEndpoint: "https://api.softwareone.com",
            apiToken: "",
            syncInterval: 60,
            enableAutoSync: !1
          },
          validationSchema: Gh,
          onSubmit: async (v, { setSubmitting: b }) => {
            try {
              await x(v), u({ success: !0, message: "Configuration saved successfully" });
            } catch (j) {
              u({
                success: !1,
                message: j instanceof Error ? j.message : "Failed to save configuration"
              });
            } finally {
              b(!1);
            }
          },
          children: ({ errors: v, touched: b, isSubmitting: j }) => /* @__PURE__ */ o.jsxDEV(no, { className: "space-y-4", children: [
            /* @__PURE__ */ o.jsxDEV("div", { children: [
              /* @__PURE__ */ o.jsxDEV("label", { htmlFor: "apiEndpoint", className: "block text-sm font-medium mb-1", children: "API Endpoint" }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 168,
                columnNumber: 19
              }, void 0),
              /* @__PURE__ */ o.jsxDEV(
                $a,
                {
                  as: "input",
                  id: "apiEndpoint",
                  name: "apiEndpoint",
                  type: "url",
                  placeholder: "https://api.softwareone.com",
                  className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                },
                void 0,
                !1,
                {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                  lineNumber: 171,
                  columnNumber: 19
                },
                void 0
              ),
              v.apiEndpoint && b.apiEndpoint && /* @__PURE__ */ o.jsxDEV("div", { className: "text-red-500 text-sm mt-1", children: v.apiEndpoint }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 180,
                columnNumber: 21
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 167,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("div", { children: [
              /* @__PURE__ */ o.jsxDEV("label", { htmlFor: "apiToken", className: "block text-sm font-medium mb-1", children: "API Token" }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 185,
                columnNumber: 19
              }, void 0),
              /* @__PURE__ */ o.jsxDEV(
                $a,
                {
                  as: "input",
                  id: "apiToken",
                  name: "apiToken",
                  type: "password",
                  placeholder: "Enter your API token",
                  className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                },
                void 0,
                !1,
                {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                  lineNumber: 188,
                  columnNumber: 19
                },
                void 0
              ),
              v.apiToken && b.apiToken && /* @__PURE__ */ o.jsxDEV("div", { className: "text-red-500 text-sm mt-1", children: v.apiToken }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 197,
                columnNumber: 21
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 184,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("div", { className: "flex gap-4", children: [
              /* @__PURE__ */ o.jsxDEV(
                "button",
                {
                  type: "submit",
                  disabled: j,
                  className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed",
                  children: j ? "Saving..." : "Save Configuration"
                },
                void 0,
                !1,
                {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                  lineNumber: 202,
                  columnNumber: 19
                },
                void 0
              ),
              /* @__PURE__ */ o.jsxDEV(
                "button",
                {
                  type: "button",
                  onClick: E,
                  disabled: !(r != null && r.apiToken) || !(r != null && r.apiEndpoint),
                  className: "px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed",
                  children: "Test Connection"
                },
                void 0,
                !1,
                {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                  lineNumber: 209,
                  columnNumber: 19
                },
                void 0
              )
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 201,
              columnNumber: 17
            }, void 0),
            l && /* @__PURE__ */ o.jsxDEV("div", { className: `p-4 rounded-md ${l.success ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`, children: l.message }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 220,
              columnNumber: 19
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 166,
            columnNumber: 15
          }, void 0)
        },
        void 0,
        !1,
        {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
          lineNumber: 143,
          columnNumber: 11
        },
        void 0
      ) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
        lineNumber: 142,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "sync", children: /* @__PURE__ */ o.jsxDEV("div", { className: "space-y-6", children: /* @__PURE__ */ o.jsxDEV("div", { children: [
        /* @__PURE__ */ o.jsxDEV("h3", { className: "text-lg font-semibold mb-4", children: "Synchronization Settings" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
          lineNumber: 232,
          columnNumber: 15
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("div", { className: "space-y-4", children: [
          /* @__PURE__ */ o.jsxDEV("div", { children: [
            /* @__PURE__ */ o.jsxDEV("label", { className: "block text-sm font-medium mb-1", children: "Sync Interval (minutes)" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 236,
              columnNumber: 19
            }, void 0),
            /* @__PURE__ */ o.jsxDEV(
              "input",
              {
                type: "number",
                value: (r == null ? void 0 : r.syncInterval) || 60,
                onChange: (v) => s((b) => b ? { ...b, syncInterval: parseInt(v.target.value) } : null),
                min: 15,
                max: 1440,
                className: "w-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              },
              void 0,
              !1,
              {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 239,
                columnNumber: 19
              },
              void 0
            )
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 235,
            columnNumber: 17
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ o.jsxDEV(
              "input",
              {
                type: "checkbox",
                id: "enableAutoSync",
                checked: (r == null ? void 0 : r.enableAutoSync) || !1,
                onChange: (v) => s((b) => b ? { ...b, enableAutoSync: v.target.checked } : null)
              },
              void 0,
              !1,
              {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 250,
                columnNumber: 19
              },
              void 0
            ),
            /* @__PURE__ */ o.jsxDEV("label", { htmlFor: "enableAutoSync", className: "text-sm", children: "Enable automatic synchronization" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 256,
              columnNumber: 19
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 249,
            columnNumber: 17
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { className: "pt-4", children: /* @__PURE__ */ o.jsxDEV(
            "button",
            {
              onClick: g,
              disabled: !(r != null && r.apiToken),
              className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed",
              children: "Run Manual Sync"
            },
            void 0,
            !1,
            {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 262,
              columnNumber: 19
            },
            void 0
          ) }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 261,
            columnNumber: 17
          }, void 0),
          f && /* @__PURE__ */ o.jsxDEV("div", { className: `p-4 rounded-md ${f.success ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`, children: /* @__PURE__ */ o.jsxDEV("div", { children: [
            /* @__PURE__ */ o.jsxDEV("strong", { children: f.message }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 274,
              columnNumber: 23
            }, void 0),
            f.counts && /* @__PURE__ */ o.jsxDEV("div", { className: "mt-2 text-sm", children: [
              /* @__PURE__ */ o.jsxDEV("div", { children: [
                "Agreements: ",
                f.counts.agreements
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 277,
                columnNumber: 27
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("div", { children: [
                "Statements: ",
                f.counts.statements
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 278,
                columnNumber: 27
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("div", { children: [
                "Subscriptions: ",
                f.counts.subscriptions
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 279,
                columnNumber: 27
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("div", { children: [
                "Orders: ",
                f.counts.orders
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 280,
                columnNumber: 27
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 276,
              columnNumber: 25
            }, void 0),
            f.errors && f.errors.length > 0 && /* @__PURE__ */ o.jsxDEV("div", { className: "mt-2 text-sm", children: [
              /* @__PURE__ */ o.jsxDEV("strong", { children: "Errors:" }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 285,
                columnNumber: 27
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("ul", { className: "list-disc list-inside", children: f.errors.map((v, b) => /* @__PURE__ */ o.jsxDEV("li", { children: v }, b, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 288,
                columnNumber: 31
              }, void 0)) }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 286,
                columnNumber: 27
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 284,
              columnNumber: 25
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 273,
            columnNumber: 21
          }, void 0) }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 272,
            columnNumber: 19
          }, void 0),
          m && /* @__PURE__ */ o.jsxDEV("div", { className: "mt-6 p-4 bg-gray-50 rounded", children: [
            /* @__PURE__ */ o.jsxDEV("h4", { className: "font-medium mb-2", children: "Last Sync Information" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 299,
              columnNumber: 21
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("div", { className: "text-sm space-y-1", children: [
              /* @__PURE__ */ o.jsxDEV("div", { children: [
                "Timestamp: ",
                new Date(m.timestamp).toLocaleString()
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 301,
                columnNumber: 23
              }, void 0),
              m.counts && /* @__PURE__ */ o.jsxDEV(o.Fragment, { children: [
                /* @__PURE__ */ o.jsxDEV("div", { children: [
                  "Agreements synced: ",
                  m.counts.agreements
                ] }, void 0, !0, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                  lineNumber: 304,
                  columnNumber: 27
                }, void 0),
                /* @__PURE__ */ o.jsxDEV("div", { children: [
                  "Statements synced: ",
                  m.counts.statements
                ] }, void 0, !0, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                  lineNumber: 305,
                  columnNumber: 27
                }, void 0)
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 303,
                columnNumber: 25
              }, void 0),
              m.errors && m.errors.length > 0 && /* @__PURE__ */ o.jsxDEV("div", { className: "text-red-600", children: [
                "Errors: ",
                m.errors.length
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
                lineNumber: 309,
                columnNumber: 25
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 300,
              columnNumber: 21
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 298,
            columnNumber: 19
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
          lineNumber: 234,
          columnNumber: 15
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
        lineNumber: 231,
        columnNumber: 13
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
        lineNumber: 230,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
        lineNumber: 229,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "advanced", children: /* @__PURE__ */ o.jsxDEV("div", { className: "space-y-4", children: [
        /* @__PURE__ */ o.jsxDEV("h3", { className: "text-lg font-semibold mb-4", children: "Advanced Settings" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
          lineNumber: 321,
          columnNumber: 13
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("div", { className: "p-4 rounded-md bg-blue-50 text-blue-800 border border-blue-200", children: [
          /* @__PURE__ */ o.jsxDEV("p", { className: "text-sm", children: "Advanced configuration options will be available in future versions. This may include:" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 324,
            columnNumber: 15
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("ul", { className: "list-disc list-inside mt-2 text-sm", children: [
            /* @__PURE__ */ o.jsxDEV("li", { children: "Custom field mappings" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 329,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("li", { children: "Webhook configuration" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 330,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("li", { children: "API rate limiting settings" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 331,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("li", { children: "Data retention policies" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 332,
              columnNumber: 17
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 328,
            columnNumber: 15
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
          lineNumber: 323,
          columnNumber: 13
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("div", { className: "mt-6", children: [
          /* @__PURE__ */ o.jsxDEV("h4", { className: "font-medium mb-2", children: "Extension Information" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 337,
            columnNumber: 15
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { className: "text-sm space-y-1", children: [
            /* @__PURE__ */ o.jsxDEV("div", { children: "Version: 0.1.0" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 339,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("div", { children: [
              "Tenant: ",
              t.tenant.name
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 340,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("div", { children: [
              "User: ",
              t.user.email
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
              lineNumber: 341,
              columnNumber: 17
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
            lineNumber: 338,
            columnNumber: 15
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
          lineNumber: 336,
          columnNumber: 13
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
        lineNumber: 320,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
        lineNumber: 319,
        columnNumber: 9
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
      lineNumber: 129,
      columnNumber: 7
    }, void 0)
  ] }, void 0, !0, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/SettingsPage.tsx",
    lineNumber: 126,
    columnNumber: 5
  }, void 0);
};
var ea = class {
  constructor() {
    this.listeners = /* @__PURE__ */ new Set(), this.subscribe = this.subscribe.bind(this);
  }
  subscribe(t) {
    return this.listeners.add(t), this.onSubscribe(), () => {
      this.listeners.delete(t), this.onUnsubscribe();
    };
  }
  hasListeners() {
    return this.listeners.size > 0;
  }
  onSubscribe() {
  }
  onUnsubscribe() {
  }
}, Mn = typeof window > "u" || "Deno" in globalThis;
function vs() {
}
function li(t) {
  return typeof t == "number" && t >= 0 && t !== 1 / 0;
}
function Kh(t, e) {
  return Math.max(t + (e || 0) - Date.now(), 0);
}
function Pn(t, e) {
  return typeof t == "function" ? t(e) : t;
}
function ut(t, e) {
  return typeof t == "function" ? t(e) : t;
}
function ys(t, e) {
  if (t === e)
    return t;
  const n = ui(t) && ui(e);
  if (n || ci(t) && ci(e)) {
    const r = n ? t : Object.keys(t), s = r.length, a = n ? e : Object.keys(e), i = a.length, l = n ? [] : {}, u = new Set(r);
    let f = 0;
    for (let d = 0; d < i; d++) {
      const m = n ? d : a[d];
      (!n && u.has(m) || n) && t[m] === void 0 && e[m] === void 0 ? (l[m] = void 0, f++) : (l[m] = ys(t[m], e[m]), l[m] === t[m] && t[m] !== void 0 && f++);
    }
    return s === i && f === s ? t : l;
  }
  return e;
}
function ws(t, e) {
  if (!e || Object.keys(t).length !== Object.keys(e).length)
    return !1;
  for (const n in t)
    if (t[n] !== e[n])
      return !1;
  return !0;
}
function ui(t) {
  return Array.isArray(t) && t.length === Object.keys(t).length;
}
function ci(t) {
  if (!di(t))
    return !1;
  const e = t.constructor;
  if (e === void 0)
    return !0;
  const n = e.prototype;
  return !(!di(n) || !n.hasOwnProperty("isPrototypeOf") || Object.getPrototypeOf(t) !== Object.prototype);
}
function di(t) {
  return Object.prototype.toString.call(t) === "[object Object]";
}
function fi(t, e, n) {
  if (typeof n.structuralSharing == "function")
    return n.structuralSharing(t, e);
  if (n.structuralSharing !== !1) {
    if (process.env.NODE_ENV !== "production")
      try {
        return ys(t, e);
      } catch (r) {
        throw console.error(
          `Structural sharing requires data to be JSON serializable. To fix this, turn off structuralSharing or return JSON-serializable data from your queryFn. [${n.queryHash}]: ${r}`
        ), r;
      }
    return ys(t, e);
  }
  return e;
}
function Jh(t, e) {
  return typeof t == "function" ? t(...e) : !!t;
}
var Lt, Et, on, bi, Qh = (bi = class extends ea {
  constructor() {
    super();
    ce(this, Lt);
    ce(this, Et);
    ce(this, on);
    X(this, on, (e) => {
      if (!Mn && window.addEventListener) {
        const n = () => e();
        return window.addEventListener("visibilitychange", n, !1), () => {
          window.removeEventListener("visibilitychange", n);
        };
      }
    });
  }
  onSubscribe() {
    _(this, Et) || this.setEventListener(_(this, on));
  }
  onUnsubscribe() {
    var e;
    this.hasListeners() || ((e = _(this, Et)) == null || e.call(this), X(this, Et, void 0));
  }
  setEventListener(e) {
    var n;
    X(this, on, e), (n = _(this, Et)) == null || n.call(this), X(this, Et, e((r) => {
      typeof r == "boolean" ? this.setFocused(r) : this.onFocus();
    }));
  }
  setFocused(e) {
    _(this, Lt) !== e && (X(this, Lt, e), this.onFocus());
  }
  onFocus() {
    const e = this.isFocused();
    this.listeners.forEach((n) => {
      n(e);
    });
  }
  isFocused() {
    var e;
    return typeof _(this, Lt) == "boolean" ? _(this, Lt) : ((e = globalThis.document) == null ? void 0 : e.visibilityState) !== "hidden";
  }
}, Lt = new WeakMap(), Et = new WeakMap(), on = new WeakMap(), bi), Xh = new Qh(), ln, St, un, Ni, Zh = (Ni = class extends ea {
  constructor() {
    super();
    ce(this, ln, !0);
    ce(this, St);
    ce(this, un);
    X(this, un, (e) => {
      if (!Mn && window.addEventListener) {
        const n = () => e(!0), r = () => e(!1);
        return window.addEventListener("online", n, !1), window.addEventListener("offline", r, !1), () => {
          window.removeEventListener("online", n), window.removeEventListener("offline", r);
        };
      }
    });
  }
  onSubscribe() {
    _(this, St) || this.setEventListener(_(this, un));
  }
  onUnsubscribe() {
    var e;
    this.hasListeners() || ((e = _(this, St)) == null || e.call(this), X(this, St, void 0));
  }
  setEventListener(e) {
    var n;
    X(this, un, e), (n = _(this, St)) == null || n.call(this), X(this, St, e(this.setOnline.bind(this)));
  }
  setOnline(e) {
    _(this, ln) !== e && (X(this, ln, e), this.listeners.forEach((r) => {
      r(e);
    }));
  }
  isOnline() {
    return _(this, ln);
  }
}, ln = new WeakMap(), St = new WeakMap(), un = new WeakMap(), Ni), eg = new Zh();
function mi() {
  let t, e;
  const n = new Promise((s, a) => {
    t = s, e = a;
  });
  n.status = "pending", n.catch(() => {
  });
  function r(s) {
    Object.assign(n, s), delete n.resolve, delete n.reject;
  }
  return n.resolve = (s) => {
    r({
      status: "fulfilled",
      value: s
    }), t(s);
  }, n.reject = (s) => {
    r({
      status: "rejected",
      reason: s
    }), e(s);
  }, n;
}
function tg(t) {
  return (t ?? "online") === "online" ? eg.isOnline() : !0;
}
var ng = (t) => setTimeout(t, 0);
function rg() {
  let t = [], e = 0, n = (l) => {
    l();
  }, r = (l) => {
    l();
  }, s = ng;
  const a = (l) => {
    e ? t.push(l) : s(() => {
      n(l);
    });
  }, i = () => {
    const l = t;
    t = [], l.length && s(() => {
      r(() => {
        l.forEach((u) => {
          n(u);
        });
      });
    });
  };
  return {
    batch: (l) => {
      let u;
      e++;
      try {
        u = l();
      } finally {
        e--, e || i();
      }
      return u;
    },
    /**
     * All calls to the wrapped function will be batched.
     */
    batchCalls: (l) => (...u) => {
      a(() => {
        l(...u);
      });
    },
    schedule: a,
    /**
     * Use this method to set a custom notify function.
     * This can be used to for example wrap notifications with `React.act` while running tests.
     */
    setNotifyFunction: (l) => {
      n = l;
    },
    /**
     * Use this method to set a custom function to batch notifications together into a single tick.
     * By default React Query will use the batch function provided by ReactDOM or React Native.
     */
    setBatchNotifyFunction: (l) => {
      r = l;
    },
    setScheduler: (l) => {
      s = l;
    }
  };
}
var dl = rg();
function sg(t, e) {
  return {
    fetchFailureCount: 0,
    fetchFailureReason: null,
    fetchStatus: tg(e.networkMode) ? "fetching" : "paused",
    ...t === void 0 && {
      error: null,
      status: "pending"
    }
  };
}
var Ve, J, Un, Se, Mt, cn, Dt, At, Bn, dn, fn, Ut, Bt, jt, mn, te, Cn, Es, Ss, Ds, As, js, Ts, _s, fl, vi, ag = (vi = class extends ea {
  constructor(e, n) {
    super();
    ce(this, te);
    ce(this, Ve);
    ce(this, J);
    ce(this, Un);
    ce(this, Se);
    ce(this, Mt);
    ce(this, cn);
    ce(this, Dt);
    ce(this, At);
    ce(this, Bn);
    ce(this, dn);
    // This property keeps track of the last query with defined data.
    // It will be used to pass the previous data and query to the placeholder function between renders.
    ce(this, fn);
    ce(this, Ut);
    ce(this, Bt);
    ce(this, jt);
    ce(this, mn, /* @__PURE__ */ new Set());
    this.options = n, X(this, Ve, e), X(this, At, null), X(this, Dt, mi()), this.options.experimental_prefetchInRender || _(this, Dt).reject(
      new Error("experimental_prefetchInRender feature flag is not enabled")
    ), this.bindMethods(), this.setOptions(n);
  }
  bindMethods() {
    this.refetch = this.refetch.bind(this);
  }
  onSubscribe() {
    this.listeners.size === 1 && (_(this, J).addObserver(this), pi(_(this, J), this.options) ? ge(this, te, Cn).call(this) : this.updateResult(), ge(this, te, As).call(this));
  }
  onUnsubscribe() {
    this.hasListeners() || this.destroy();
  }
  shouldFetchOnReconnect() {
    return Rs(
      _(this, J),
      this.options,
      this.options.refetchOnReconnect
    );
  }
  shouldFetchOnWindowFocus() {
    return Rs(
      _(this, J),
      this.options,
      this.options.refetchOnWindowFocus
    );
  }
  destroy() {
    this.listeners = /* @__PURE__ */ new Set(), ge(this, te, js).call(this), ge(this, te, Ts).call(this), _(this, J).removeObserver(this);
  }
  setOptions(e) {
    const n = this.options, r = _(this, J);
    if (this.options = _(this, Ve).defaultQueryOptions(e), this.options.enabled !== void 0 && typeof this.options.enabled != "boolean" && typeof this.options.enabled != "function" && typeof ut(this.options.enabled, _(this, J)) != "boolean")
      throw new Error(
        "Expected enabled to be a boolean or a callback that returns a boolean"
      );
    ge(this, te, _s).call(this), _(this, J).setOptions(this.options), n._defaulted && !ws(this.options, n) && _(this, Ve).getQueryCache().notify({
      type: "observerOptionsUpdated",
      query: _(this, J),
      observer: this
    });
    const s = this.hasListeners();
    s && hi(
      _(this, J),
      r,
      this.options,
      n
    ) && ge(this, te, Cn).call(this), this.updateResult(), s && (_(this, J) !== r || ut(this.options.enabled, _(this, J)) !== ut(n.enabled, _(this, J)) || Pn(this.options.staleTime, _(this, J)) !== Pn(n.staleTime, _(this, J))) && ge(this, te, Es).call(this);
    const a = ge(this, te, Ss).call(this);
    s && (_(this, J) !== r || ut(this.options.enabled, _(this, J)) !== ut(n.enabled, _(this, J)) || a !== _(this, jt)) && ge(this, te, Ds).call(this, a);
  }
  getOptimisticResult(e) {
    const n = _(this, Ve).getQueryCache().build(_(this, Ve), e), r = this.createResult(n, e);
    return og(this, r) && (X(this, Se, r), X(this, cn, this.options), X(this, Mt, _(this, J).state)), r;
  }
  getCurrentResult() {
    return _(this, Se);
  }
  trackResult(e, n) {
    return new Proxy(e, {
      get: (r, s) => (this.trackProp(s), n == null || n(s), Reflect.get(r, s))
    });
  }
  trackProp(e) {
    _(this, mn).add(e);
  }
  getCurrentQuery() {
    return _(this, J);
  }
  refetch({ ...e } = {}) {
    return this.fetch({
      ...e
    });
  }
  fetchOptimistic(e) {
    const n = _(this, Ve).defaultQueryOptions(e), r = _(this, Ve).getQueryCache().build(_(this, Ve), n);
    return r.fetch().then(() => this.createResult(r, n));
  }
  fetch(e) {
    return ge(this, te, Cn).call(this, {
      ...e,
      cancelRefetch: e.cancelRefetch ?? !0
    }).then(() => (this.updateResult(), _(this, Se)));
  }
  createResult(e, n) {
    var ue;
    const r = _(this, J), s = this.options, a = _(this, Se), i = _(this, Mt), l = _(this, cn), f = e !== r ? e.state : _(this, Un), { state: d } = e;
    let m = { ...d }, h = !1, S;
    if (n._optimisticResults) {
      const ne = this.hasListeners(), G = !ne && pi(e, n), ae = ne && hi(e, r, n, s);
      (G || ae) && (m = {
        ...m,
        ...sg(d.data, e.options)
      }), n._optimisticResults === "isRestoring" && (m.fetchStatus = "idle");
    }
    let { error: x, errorUpdatedAt: E, status: g } = m;
    S = m.data;
    let v = !1;
    if (n.placeholderData !== void 0 && S === void 0 && g === "pending") {
      let ne;
      a != null && a.isPlaceholderData && n.placeholderData === (l == null ? void 0 : l.placeholderData) ? (ne = a.data, v = !0) : ne = typeof n.placeholderData == "function" ? n.placeholderData(
        (ue = _(this, fn)) == null ? void 0 : ue.state.data,
        _(this, fn)
      ) : n.placeholderData, ne !== void 0 && (g = "success", S = fi(
        a == null ? void 0 : a.data,
        ne,
        n
      ), h = !0);
    }
    if (n.select && S !== void 0 && !v)
      if (a && S === (i == null ? void 0 : i.data) && n.select === _(this, Bn))
        S = _(this, dn);
      else
        try {
          X(this, Bn, n.select), S = n.select(S), S = fi(a == null ? void 0 : a.data, S, n), X(this, dn, S), X(this, At, null);
        } catch (ne) {
          X(this, At, ne);
        }
    _(this, At) && (x = _(this, At), S = _(this, dn), E = Date.now(), g = "error");
    const b = m.fetchStatus === "fetching", j = g === "pending", F = g === "error", D = j && b, R = S !== void 0, Y = {
      status: g,
      fetchStatus: m.fetchStatus,
      isPending: j,
      isSuccess: g === "success",
      isError: F,
      isInitialLoading: D,
      isLoading: D,
      data: S,
      dataUpdatedAt: m.dataUpdatedAt,
      error: x,
      errorUpdatedAt: E,
      failureCount: m.fetchFailureCount,
      failureReason: m.fetchFailureReason,
      errorUpdateCount: m.errorUpdateCount,
      isFetched: m.dataUpdateCount > 0 || m.errorUpdateCount > 0,
      isFetchedAfterMount: m.dataUpdateCount > f.dataUpdateCount || m.errorUpdateCount > f.errorUpdateCount,
      isFetching: b,
      isRefetching: b && !j,
      isLoadingError: F && !R,
      isPaused: m.fetchStatus === "paused",
      isPlaceholderData: h,
      isRefetchError: F && R,
      isStale: ta(e, n),
      refetch: this.refetch,
      promise: _(this, Dt)
    };
    if (this.options.experimental_prefetchInRender) {
      const ne = (q) => {
        Y.status === "error" ? q.reject(Y.error) : Y.data !== void 0 && q.resolve(Y.data);
      }, G = () => {
        const q = X(this, Dt, Y.promise = mi());
        ne(q);
      }, ae = _(this, Dt);
      switch (ae.status) {
        case "pending":
          e.queryHash === r.queryHash && ne(ae);
          break;
        case "fulfilled":
          (Y.status === "error" || Y.data !== ae.value) && G();
          break;
        case "rejected":
          (Y.status !== "error" || Y.error !== ae.reason) && G();
          break;
      }
    }
    return Y;
  }
  updateResult() {
    const e = _(this, Se), n = this.createResult(_(this, J), this.options);
    if (X(this, Mt, _(this, J).state), X(this, cn, this.options), _(this, Mt).data !== void 0 && X(this, fn, _(this, J)), ws(n, e))
      return;
    X(this, Se, n);
    const r = () => {
      if (!e)
        return !0;
      const { notifyOnChangeProps: s } = this.options, a = typeof s == "function" ? s() : s;
      if (a === "all" || !a && !_(this, mn).size)
        return !0;
      const i = new Set(
        a ?? _(this, mn)
      );
      return this.options.throwOnError && i.add("error"), Object.keys(_(this, Se)).some((l) => {
        const u = l;
        return _(this, Se)[u] !== e[u] && i.has(u);
      });
    };
    ge(this, te, fl).call(this, { listeners: r() });
  }
  onQueryUpdate() {
    this.updateResult(), this.hasListeners() && ge(this, te, As).call(this);
  }
}, Ve = new WeakMap(), J = new WeakMap(), Un = new WeakMap(), Se = new WeakMap(), Mt = new WeakMap(), cn = new WeakMap(), Dt = new WeakMap(), At = new WeakMap(), Bn = new WeakMap(), dn = new WeakMap(), fn = new WeakMap(), Ut = new WeakMap(), Bt = new WeakMap(), jt = new WeakMap(), mn = new WeakMap(), te = new WeakSet(), Cn = function(e) {
  ge(this, te, _s).call(this);
  let n = _(this, J).fetch(
    this.options,
    e
  );
  return e != null && e.throwOnError || (n = n.catch(vs)), n;
}, Es = function() {
  ge(this, te, js).call(this);
  const e = Pn(
    this.options.staleTime,
    _(this, J)
  );
  if (Mn || _(this, Se).isStale || !li(e))
    return;
  const r = Kh(_(this, Se).dataUpdatedAt, e) + 1;
  X(this, Ut, setTimeout(() => {
    _(this, Se).isStale || this.updateResult();
  }, r));
}, Ss = function() {
  return (typeof this.options.refetchInterval == "function" ? this.options.refetchInterval(_(this, J)) : this.options.refetchInterval) ?? !1;
}, Ds = function(e) {
  ge(this, te, Ts).call(this), X(this, jt, e), !(Mn || ut(this.options.enabled, _(this, J)) === !1 || !li(_(this, jt)) || _(this, jt) === 0) && X(this, Bt, setInterval(() => {
    (this.options.refetchIntervalInBackground || Xh.isFocused()) && ge(this, te, Cn).call(this);
  }, _(this, jt)));
}, As = function() {
  ge(this, te, Es).call(this), ge(this, te, Ds).call(this, ge(this, te, Ss).call(this));
}, js = function() {
  _(this, Ut) && (clearTimeout(_(this, Ut)), X(this, Ut, void 0));
}, Ts = function() {
  _(this, Bt) && (clearInterval(_(this, Bt)), X(this, Bt, void 0));
}, _s = function() {
  const e = _(this, Ve).getQueryCache().build(_(this, Ve), this.options);
  if (e === _(this, J))
    return;
  const n = _(this, J);
  X(this, J, e), X(this, Un, e.state), this.hasListeners() && (n == null || n.removeObserver(this), e.addObserver(this));
}, fl = function(e) {
  dl.batch(() => {
    e.listeners && this.listeners.forEach((n) => {
      n(_(this, Se));
    }), _(this, Ve).getQueryCache().notify({
      query: _(this, J),
      type: "observerResultsUpdated"
    });
  });
}, vi);
function ig(t, e) {
  return ut(e.enabled, t) !== !1 && t.state.data === void 0 && !(t.state.status === "error" && e.retryOnMount === !1);
}
function pi(t, e) {
  return ig(t, e) || t.state.data !== void 0 && Rs(t, e, e.refetchOnMount);
}
function Rs(t, e, n) {
  if (ut(e.enabled, t) !== !1 && Pn(e.staleTime, t) !== "static") {
    const r = typeof n == "function" ? n(t) : n;
    return r === "always" || r !== !1 && ta(t, e);
  }
  return !1;
}
function hi(t, e, n, r) {
  return (t !== e || ut(r.enabled, t) === !1) && (!n.suspense || t.state.status !== "error") && ta(t, n);
}
function ta(t, e) {
  return ut(e.enabled, t) !== !1 && t.isStaleByTime(Pn(e.staleTime, t));
}
function og(t, e) {
  return !ws(t.getCurrentResult(), e);
}
var lg = O.createContext(
  void 0
), ug = (t) => {
  const e = O.useContext(lg);
  if (!e)
    throw new Error("No QueryClient set, use QueryClientProvider to set one");
  return e;
}, ml = O.createContext(!1), cg = () => O.useContext(ml);
ml.Provider;
function dg() {
  let t = !1;
  return {
    clearReset: () => {
      t = !1;
    },
    reset: () => {
      t = !0;
    },
    isReset: () => t
  };
}
var fg = O.createContext(dg()), mg = () => O.useContext(fg), pg = (t, e) => {
  (t.suspense || t.throwOnError || t.experimental_prefetchInRender) && (e.isReset() || (t.retryOnMount = !1));
}, hg = (t) => {
  O.useEffect(() => {
    t.clearReset();
  }, [t]);
}, gg = ({
  result: t,
  errorResetBoundary: e,
  throwOnError: n,
  query: r,
  suspense: s
}) => t.isError && !e.isReset() && !t.isFetching && r && (s && t.data === void 0 || Jh(n, [t.error, r])), xg = (t) => {
  if (t.suspense) {
    const e = (r) => r === "static" ? r : Math.max(r ?? 1e3, 1e3), n = t.staleTime;
    t.staleTime = typeof n == "function" ? (...r) => e(n(...r)) : e(n), typeof t.gcTime == "number" && (t.gcTime = Math.max(t.gcTime, 1e3));
  }
}, bg = (t, e) => t.isLoading && t.isFetching && !e, Ng = (t, e) => (t == null ? void 0 : t.suspense) && e.isPending, gi = (t, e, n) => e.fetchOptimistic(t).catch(() => {
  n.clearReset();
});
function vg(t, e, n) {
  var m, h, S, x, E;
  if (process.env.NODE_ENV !== "production" && (typeof t != "object" || Array.isArray(t)))
    throw new Error(
      'Bad argument type. Starting with v5, only the "Object" form is allowed when calling query related functions. Please use the error stack to find the culprit call. More info here: https://tanstack.com/query/latest/docs/react/guides/migrating-to-v5#supports-a-single-signature-one-object'
    );
  const r = cg(), s = mg(), a = ug(), i = a.defaultQueryOptions(t);
  (h = (m = a.getDefaultOptions().queries) == null ? void 0 : m._experimental_beforeQuery) == null || h.call(
    m,
    i
  ), process.env.NODE_ENV !== "production" && (i.queryFn || console.error(
    `[${i.queryHash}]: No queryFn was passed as an option, and no default queryFn was found. The queryFn parameter is only optional when using a default queryFn. More info here: https://tanstack.com/query/latest/docs/framework/react/guides/default-query-function`
  )), i._optimisticResults = r ? "isRestoring" : "optimistic", xg(i), pg(i, s), hg(s);
  const l = !a.getQueryCache().get(i.queryHash), [u] = O.useState(
    () => new e(
      a,
      i
    )
  ), f = u.getOptimisticResult(i), d = !r && t.subscribed !== !1;
  if (O.useSyncExternalStore(
    O.useCallback(
      (g) => {
        const v = d ? u.subscribe(dl.batchCalls(g)) : vs;
        return u.updateResult(), v;
      },
      [u, d]
    ),
    () => u.getCurrentResult(),
    () => u.getCurrentResult()
  ), O.useEffect(() => {
    u.setOptions(i);
  }, [i, u]), Ng(i, f))
    throw gi(i, u, s);
  if (gg({
    result: f,
    errorResetBoundary: s,
    throwOnError: i.throwOnError,
    query: a.getQueryCache().get(i.queryHash),
    suspense: i.suspense
  }))
    throw f.error;
  if ((x = (S = a.getDefaultOptions().queries) == null ? void 0 : S._experimental_afterQuery) == null || x.call(
    S,
    i,
    f
  ), i.experimental_prefetchInRender && !Mn && bg(f, r)) {
    const g = l ? (
      // Fetch immediately on render in order to ensure `.promise` is resolved even if the component is unmounted
      gi(i, u, s)
    ) : (
      // subscribe to the "cache promise" so that we can finalize the currentThenable once data comes in
      (E = a.getQueryCache().get(i.queryHash)) == null ? void 0 : E.promise
    );
    g == null || g.catch(vs).finally(() => {
      u.updateResult();
    });
  }
  return i.notifyOnChangeProps ? f : u.trackResult(f);
}
function yg(t, e) {
  return vg(t, ag);
}
function Tt(t, e, n) {
  const r = Array.isArray(t) ? t : [t];
  return yg({
    queryKey: ["swone", ...r],
    queryFn: e,
    staleTime: 5 * 60 * 1e3,
    // 5 minutes
    gcTime: 15 * 60 * 1e3,
    // 15 minutes
    ...n
  });
}
const Hg = ({ context: t }) => {
  const e = Nr(), { storage: n, logger: r } = t, [s, a] = Ae([]), [i, l] = Ae("all"), { data: u, isLoading: f, error: d, refetch: m } = Tt(
    ["agreements", i],
    async () => {
      const g = n.getNamespace("swone");
      return i === "all" ? await g.get("agreements") || [] : (await g.get("agreements/byStatus") || {})[i] || [];
    },
    {
      staleTime: 2 * 60 * 1e3
      // 2 minutes
    }
  ), h = async () => {
    try {
      const g = await n.getNamespace("swone").get("config");
      if (!g)
        throw new Error("Please configure API settings first");
      await new Gn(g, t).performFullSync(), m();
    } catch (g) {
      r.error("Sync failed", g);
    }
  }, S = (g) => {
    e(`/softwareone/agreement/${g.id}`);
  }, x = (g) => {
    a((v) => v.includes(g) ? v.filter((b) => b !== g) : [...v, g]);
  }, E = () => {
    s.length === (u == null ? void 0 : u.length) ? a([]) : a((u == null ? void 0 : u.map((g) => g.id)) || []);
  };
  return d ? /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: /* @__PURE__ */ o.jsxDEV("div", { className: "p-4 rounded-md bg-red-50 text-red-800 border border-red-200", children: [
    "Failed to load agreements: ",
    d instanceof Error ? d.message : "Unknown error"
  ] }, void 0, !0, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
    lineNumber: 80,
    columnNumber: 9
  }, void 0) }, void 0, !1, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
    lineNumber: 79,
    columnNumber: 7
  }, void 0) : /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: [
    /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between items-center mb-6", children: [
      /* @__PURE__ */ o.jsxDEV("h1", { className: "text-2xl font-bold", children: "SoftwareOne Agreements" }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
        lineNumber: 90,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "flex gap-3", children: [
        /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => e("/settings/softwareone"),
            className: "px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300",
            children: "Settings"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
            lineNumber: 93,
            columnNumber: 11
          },
          void 0
        ),
        /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: h,
            className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700",
            children: "Sync Now"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
            lineNumber: 99,
            columnNumber: 11
          },
          void 0
        )
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
        lineNumber: 92,
        columnNumber: 9
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
      lineNumber: 89,
      columnNumber: 7
    }, void 0),
    /* @__PURE__ */ o.jsxDEV("div", { className: "mb-4 flex gap-2", children: [
      /* @__PURE__ */ o.jsxDEV(
        "button",
        {
          onClick: () => l("all"),
          className: `px-3 py-1 rounded-md text-sm ${i === "all" ? "bg-blue-600 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`,
          children: "All"
        },
        void 0,
        !1,
        {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 109,
          columnNumber: 9
        },
        void 0
      ),
      /* @__PURE__ */ o.jsxDEV(
        "button",
        {
          onClick: () => l("active"),
          className: `px-3 py-1 rounded-md text-sm ${i === "active" ? "bg-blue-600 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`,
          children: "Active"
        },
        void 0,
        !1,
        {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 119,
          columnNumber: 9
        },
        void 0
      ),
      /* @__PURE__ */ o.jsxDEV(
        "button",
        {
          onClick: () => l("inactive"),
          className: `px-3 py-1 rounded-md text-sm ${i === "inactive" ? "bg-blue-600 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`,
          children: "Inactive"
        },
        void 0,
        !1,
        {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 129,
          columnNumber: 9
        },
        void 0
      ),
      /* @__PURE__ */ o.jsxDEV(
        "button",
        {
          onClick: () => l("pending"),
          className: `px-3 py-1 rounded-md text-sm ${i === "pending" ? "bg-blue-600 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`,
          children: "Pending"
        },
        void 0,
        !1,
        {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 139,
          columnNumber: 9
        },
        void 0
      ),
      /* @__PURE__ */ o.jsxDEV(
        "button",
        {
          onClick: () => l("expired"),
          className: `px-3 py-1 rounded-md text-sm ${i === "expired" ? "bg-blue-600 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`,
          children: "Expired"
        },
        void 0,
        !1,
        {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 149,
          columnNumber: 9
        },
        void 0
      )
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
      lineNumber: 108,
      columnNumber: 7
    }, void 0),
    u && u.length === 0 ? /* @__PURE__ */ o.jsxDEV("div", { className: "p-4 rounded-md bg-blue-50 text-blue-800 border border-blue-200", children: /* @__PURE__ */ o.jsxDEV("p", { children: 'No agreements found. Click "Sync Now" to fetch agreements from SoftwareOne.' }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
      lineNumber: 163,
      columnNumber: 11
    }, void 0) }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
      lineNumber: 162,
      columnNumber: 9
    }, void 0) : /* @__PURE__ */ o.jsxDEV("div", { className: "bg-white rounded-lg shadow overflow-hidden", children: /* @__PURE__ */ o.jsxDEV("div", { className: "overflow-x-auto", children: /* @__PURE__ */ o.jsxDEV("table", { className: "min-w-full divide-y divide-gray-200", children: [
      /* @__PURE__ */ o.jsxDEV("thead", { className: "bg-gray-50", children: /* @__PURE__ */ o.jsxDEV("tr", { children: [
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-4 py-3 text-left", children: /* @__PURE__ */ o.jsxDEV(
          "input",
          {
            type: "checkbox",
            checked: s.length === (u == null ? void 0 : u.length) && (u == null ? void 0 : u.length) > 0,
            onChange: E,
            className: "rounded border-gray-300"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
            lineNumber: 172,
            columnNumber: 21
          },
          void 0
        ) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 171,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Agreement Name" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 179,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Product" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 182,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Vendor" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 185,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Consumer" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 188,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Currency" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 191,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Status" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 194,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Visibility" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 197,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Margin %" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 200,
          columnNumber: 19
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
        lineNumber: 170,
        columnNumber: 17
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
        lineNumber: 169,
        columnNumber: 15
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("tbody", { className: "bg-white divide-y divide-gray-200", children: f ? /* @__PURE__ */ o.jsxDEV("tr", { children: /* @__PURE__ */ o.jsxDEV("td", { colSpan: 9, className: "px-6 py-4 text-center text-gray-500", children: "Loading..." }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
        lineNumber: 208,
        columnNumber: 21
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
        lineNumber: 207,
        columnNumber: 19
      }, void 0) : u == null ? void 0 : u.map((g) => /* @__PURE__ */ o.jsxDEV(
        "tr",
        {
          className: "hover:bg-gray-50 cursor-pointer",
          onClick: () => S(g),
          children: [
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-4 py-4", onClick: (v) => v.stopPropagation(), children: /* @__PURE__ */ o.jsxDEV(
              "input",
              {
                type: "checkbox",
                checked: s.includes(g.id),
                onChange: () => x(g.id),
                className: "rounded border-gray-300"
              },
              void 0,
              !1,
              {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
                lineNumber: 220,
                columnNumber: 25
              },
              void 0
            ) }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 219,
              columnNumber: 23
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap", children: /* @__PURE__ */ o.jsxDEV(
              "button",
              {
                onClick: (v) => {
                  v.stopPropagation(), S(g);
                },
                className: "text-blue-600 hover:underline",
                children: g.name
              },
              void 0,
              !1,
              {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
                lineNumber: 228,
                columnNumber: 25
              },
              void 0
            ) }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 227,
              columnNumber: 23
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: g.product }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 238,
              columnNumber: 23
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: g.vendor }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 241,
              columnNumber: 23
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: g.consumer }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 244,
              columnNumber: 23
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900", children: g.currency }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 247,
              columnNumber: 23
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap", children: /* @__PURE__ */ o.jsxDEV("span", { className: `px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${g.status === "active" ? "bg-green-100 text-green-800" : g.status === "inactive" ? "bg-gray-100 text-gray-800" : g.status === "pending" ? "bg-yellow-100 text-yellow-800" : g.status === "expired" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-800"}`, children: g.status.charAt(0).toUpperCase() + g.status.slice(1) }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 251,
              columnNumber: 25
            }, void 0) }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 250,
              columnNumber: 23
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: /* @__PURE__ */ o.jsxDEV("span", { title: g.operations, children: [
              g.operations === "visible" && "👁️",
              g.operations === "hidden" && "🚫",
              g.operations === "restricted" && "🔒",
              !["visible", "hidden", "restricted"].includes(g.operations) && "❓",
              " ",
              g.operations
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 262,
              columnNumber: 25
            }, void 0) }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 261,
              columnNumber: 23
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: [
              g.marginRpxy,
              "%"
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
              lineNumber: 269,
              columnNumber: 23
            }, void 0)
          ]
        },
        g.id,
        !0,
        {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
          lineNumber: 214,
          columnNumber: 21
        },
        void 0
      )) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
        lineNumber: 205,
        columnNumber: 15
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
      lineNumber: 168,
      columnNumber: 13
    }, void 0) }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
      lineNumber: 167,
      columnNumber: 11
    }, void 0) }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
      lineNumber: 166,
      columnNumber: 9
    }, void 0),
    s.length > 0 && /* @__PURE__ */ o.jsxDEV("div", { className: "mt-4 p-4 bg-gray-50 rounded", children: /* @__PURE__ */ o.jsxDEV("p", { className: "text-sm text-gray-600", children: [
      s.length,
      " agreement",
      s.length > 1 ? "s" : "",
      " selected"
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
      lineNumber: 283,
      columnNumber: 11
    }, void 0) }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
      lineNumber: 282,
      columnNumber: 9
    }, void 0)
  ] }, void 0, !0, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementsList.tsx",
    lineNumber: 88,
    columnNumber: 5
  }, void 0);
}, xi = ({ open: t, onClose: e, children: n }) => t ? /* @__PURE__ */ o.jsxDEV("div", { className: "fixed inset-0 z-50 overflow-y-auto", children: /* @__PURE__ */ o.jsxDEV("div", { className: "flex items-center justify-center min-h-screen px-4", children: [
  /* @__PURE__ */ o.jsxDEV(
    "div",
    {
      className: "fixed inset-0 bg-black bg-opacity-50 transition-opacity",
      onClick: e
    },
    void 0,
    !1,
    {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
      lineNumber: 23,
      columnNumber: 9
    },
    void 0
  ),
  /* @__PURE__ */ o.jsxDEV("div", { className: "relative bg-white rounded-lg max-w-md w-full shadow-xl", children: n }, void 0, !1, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
    lineNumber: 27,
    columnNumber: 9
  }, void 0)
] }, void 0, !0, {
  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
  lineNumber: 22,
  columnNumber: 7
}, void 0) }, void 0, !1, {
  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
  lineNumber: 21,
  columnNumber: 5
}, void 0) : null, Gg = ({ context: t }) => {
  var F, D;
  const { id: e } = wi(), n = Nr(), { storage: r, logger: s, api: a } = t, [i, l] = Ae("overview"), [u, f] = Ae(!1), [d, m] = Ae(!1), { data: h, isLoading: S, error: x, refetch: E } = Tt(
    ["agreement", e || ""],
    async () => e && (await r.getNamespace("swone").get("agreements/byId") || {})[e] || null
  ), { data: g } = Tt(
    ["subscriptions", e || ""],
    async () => e ? await r.getNamespace("swone").get(`subscriptions/agreement/${e}`) || [] : [],
    { enabled: !!e }
  ), { data: v } = Tt(
    ["orders", e || ""],
    async () => e ? await r.getNamespace("swone").get(`orders/agreement/${e}`) || [] : [],
    { enabled: !!e }
  ), { data: b } = Tt(
    ["company", (h == null ? void 0 : h.consumer) || ""],
    async () => {
      if (!(h != null && h.consumer)) return null;
      try {
        return (await a.call("GET", "/companies")).find((k) => k.external_id === h.consumer) || null;
      } catch {
        return null;
      }
    },
    { enabled: !!(h != null && h.consumer) }
  ), j = async () => {
    try {
      if ((await a.call("POST", "/api/extensions/com.alga.softwareone/activate-agreement", {
        agreementId: e
      })).success) {
        const k = await r.getNamespace("swone").get("config"), Y = new Gn(k, t);
        e && await Y.refreshAgreement(e), E(), m(!1);
      }
    } catch (R) {
      s.error("Failed to activate agreement", R);
    }
  };
  return S ? /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: "Loading agreement details..." }, void 0, !1, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
    lineNumber: 116,
    columnNumber: 12
  }, void 0) : x || !h ? /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: [
    /* @__PURE__ */ o.jsxDEV("div", { className: "p-4 rounded-md bg-red-50 text-red-800 border border-red-200", children: "Failed to load agreement details" }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
      lineNumber: 122,
      columnNumber: 9
    }, void 0),
    /* @__PURE__ */ o.jsxDEV(
      "button",
      {
        onClick: () => n("/softwareone/agreements"),
        className: "mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700",
        children: "Back to Agreements"
      },
      void 0,
      !1,
      {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 125,
        columnNumber: 9
      },
      void 0
    )
  ] }, void 0, !0, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
    lineNumber: 121,
    columnNumber: 7
  }, void 0) : /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: [
    /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between items-start mb-6", children: [
      /* @__PURE__ */ o.jsxDEV("div", { children: [
        /* @__PURE__ */ o.jsxDEV("div", { className: "flex items-center gap-2 mb-2", children: /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => n("/softwareone/agreements"),
            className: "px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200",
            children: "← Back"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 140,
            columnNumber: 13
          },
          void 0
        ) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 139,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("h1", { className: "text-2xl font-bold", children: h.name }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 147,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("p", { className: "text-gray-600", children: [
          h.product,
          " • ",
          h.vendor
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 148,
          columnNumber: 11
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 138,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "flex gap-3", children: [
        h.status !== "active" && /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => m(!0),
            className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700",
            children: "Activate Agreement"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 153,
            columnNumber: 13
          },
          void 0
        ),
        /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => f(!0),
            className: "px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300",
            children: "Edit"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 160,
            columnNumber: 11
          },
          void 0
        )
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 151,
        columnNumber: 9
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
      lineNumber: 137,
      columnNumber: 7
    }, void 0),
    /* @__PURE__ */ o.jsxDEV(Gs, { value: i, onValueChange: l, className: "w-full", children: [
      /* @__PURE__ */ o.jsxDEV(Ks, { className: "flex border-b mb-6", children: [
        /* @__PURE__ */ o.jsxDEV(He, { value: "overview", className: "px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: "SoftwareOne" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 171,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(He, { value: "subscriptions", className: "px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: [
          "Subscriptions (",
          (g == null ? void 0 : g.length) || 0,
          ")"
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 174,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(He, { value: "orders", className: "px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: [
          "Orders (",
          (v == null ? void 0 : v.length) || 0,
          ")"
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 177,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(He, { value: "consumer", className: "px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: "Consumer" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 180,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(He, { value: "billing", className: "px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: "Billing" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 183,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(He, { value: "details", className: "px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: "Details" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 186,
          columnNumber: 11
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 170,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "overview", children: /* @__PURE__ */ o.jsxDEV("div", { className: "grid grid-cols-2 gap-6", children: [
        /* @__PURE__ */ o.jsxDEV("div", { className: "space-y-4", children: [
          /* @__PURE__ */ o.jsxDEV("div", { children: [
            /* @__PURE__ */ o.jsxDEV("h3", { className: "font-semibold mb-2", children: "Agreement Information" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 195,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("dl", { className: "space-y-2", children: [
              /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
                /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Agreement ID:" }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 198,
                  columnNumber: 21
                }, void 0),
                /* @__PURE__ */ o.jsxDEV("dd", { className: "font-mono text-sm", children: h.id }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 199,
                  columnNumber: 21
                }, void 0)
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 197,
                columnNumber: 19
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
                /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Status:" }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 202,
                  columnNumber: 21
                }, void 0),
                /* @__PURE__ */ o.jsxDEV("dd", { children: /* @__PURE__ */ o.jsxDEV("span", { className: `px-2 py-1 rounded-full text-xs font-medium ${h.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`, children: h.status }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 204,
                  columnNumber: 23
                }, void 0) }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 203,
                  columnNumber: 21
                }, void 0)
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 201,
                columnNumber: 19
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
                /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Currency:" }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 212,
                  columnNumber: 21
                }, void 0),
                /* @__PURE__ */ o.jsxDEV("dd", { children: h.currency }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 213,
                  columnNumber: 21
                }, void 0)
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 211,
                columnNumber: 19
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
                /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "SPx Year:" }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 216,
                  columnNumber: 21
                }, void 0),
                /* @__PURE__ */ o.jsxDEV("dd", { children: h.spxYear }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 217,
                  columnNumber: 21
                }, void 0)
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 215,
                columnNumber: 19
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 196,
              columnNumber: 17
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 194,
            columnNumber: 15
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { children: [
            /* @__PURE__ */ o.jsxDEV("h3", { className: "font-semibold mb-2", children: "Billing Configuration" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 223,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("dl", { className: "space-y-2", children: [
              /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
                /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Billing Config ID:" }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 226,
                  columnNumber: 21
                }, void 0),
                /* @__PURE__ */ o.jsxDEV("dd", { className: "font-mono text-sm", children: h.billingConfigId }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 227,
                  columnNumber: 21
                }, void 0)
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 225,
                columnNumber: 19
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
                /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Margin RPxy:" }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 230,
                  columnNumber: 21
                }, void 0),
                /* @__PURE__ */ o.jsxDEV("dd", { children: [
                  h.marginRpxy,
                  "%"
                ] }, void 0, !0, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 231,
                  columnNumber: 21
                }, void 0)
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 229,
                columnNumber: 19
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
                /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Operations:" }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 234,
                  columnNumber: 21
                }, void 0),
                /* @__PURE__ */ o.jsxDEV("dd", { children: h.operations }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 235,
                  columnNumber: 21
                }, void 0)
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 233,
                columnNumber: 19
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 224,
              columnNumber: 17
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 222,
            columnNumber: 15
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 193,
          columnNumber: 13
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("div", { className: "space-y-4", children: [
          /* @__PURE__ */ o.jsxDEV("div", { children: [
            /* @__PURE__ */ o.jsxDEV("h3", { className: "font-semibold mb-2", children: "Local Configuration" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 243,
              columnNumber: 17
            }, void 0),
            h.localConfig ? /* @__PURE__ */ o.jsxDEV("dl", { className: "space-y-2", children: [
              /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
                /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Markup:" }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 247,
                  columnNumber: 23
                }, void 0),
                /* @__PURE__ */ o.jsxDEV("dd", { children: [
                  h.localConfig.markup || 0,
                  "%"
                ] }, void 0, !0, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 248,
                  columnNumber: 23
                }, void 0)
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 246,
                columnNumber: 21
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
                /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Tags:" }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 251,
                  columnNumber: 23
                }, void 0),
                /* @__PURE__ */ o.jsxDEV("dd", { children: ((F = h.localConfig.tags) == null ? void 0 : F.map((R) => /* @__PURE__ */ o.jsxDEV("span", { className: "inline-block px-2 py-1 mr-1 text-xs bg-gray-100 rounded", children: R }, R, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 254,
                  columnNumber: 27
                }, void 0))) || "None" }, void 0, !1, {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                  lineNumber: 252,
                  columnNumber: 23
                }, void 0)
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 250,
                columnNumber: 21
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 245,
              columnNumber: 19
            }, void 0) : /* @__PURE__ */ o.jsxDEV("p", { className: "text-gray-500 text-sm", children: "No local configuration set" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 262,
              columnNumber: 19
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 242,
            columnNumber: 15
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { children: [
            /* @__PURE__ */ o.jsxDEV("h3", { className: "font-semibold mb-2", children: "Notes" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 267,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("p", { className: "text-sm text-gray-600", children: ((D = h.localConfig) == null ? void 0 : D.notes) || "No notes added" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 268,
              columnNumber: 17
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 266,
            columnNumber: 15
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 241,
          columnNumber: 13
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 192,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 191,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "subscriptions", children: /* @__PURE__ */ o.jsxDEV("div", { className: "bg-white rounded-lg shadow", children: g && g.length > 0 ? /* @__PURE__ */ o.jsxDEV("div", { className: "overflow-x-auto", children: /* @__PURE__ */ o.jsxDEV("table", { className: "min-w-full divide-y divide-gray-200", children: [
        /* @__PURE__ */ o.jsxDEV("thead", { className: "bg-gray-50", children: /* @__PURE__ */ o.jsxDEV("tr", { children: [
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Subscription Name" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 283,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Quantity" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 286,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Unit Price" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 289,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Status" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 292,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Start Date" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 295,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "End Date" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 298,
            columnNumber: 23
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 282,
          columnNumber: 21
        }, void 0) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 281,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("tbody", { className: "bg-white divide-y divide-gray-200", children: g.map((R) => /* @__PURE__ */ o.jsxDEV("tr", { children: [
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: R.name }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 306,
            columnNumber: 25
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: R.quantity }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 309,
            columnNumber: 25
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: [
            h.currency,
            " ",
            R.unitPrice
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 312,
            columnNumber: 25
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: R.status }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 315,
            columnNumber: 25
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: R.startDate }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 318,
            columnNumber: 25
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: R.endDate }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 321,
            columnNumber: 25
          }, void 0)
        ] }, R.id, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 305,
          columnNumber: 23
        }, void 0)) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 303,
          columnNumber: 19
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 280,
        columnNumber: 17
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 279,
        columnNumber: 15
      }, void 0) : /* @__PURE__ */ o.jsxDEV("div", { className: "p-8 text-center text-gray-500", children: "No subscriptions found for this agreement" }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 330,
        columnNumber: 15
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 277,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 276,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "orders", children: /* @__PURE__ */ o.jsxDEV("div", { className: "bg-white rounded-lg shadow", children: v && v.length > 0 ? /* @__PURE__ */ o.jsxDEV("div", { className: "overflow-x-auto", children: /* @__PURE__ */ o.jsxDEV("table", { className: "min-w-full divide-y divide-gray-200", children: [
        /* @__PURE__ */ o.jsxDEV("thead", { className: "bg-gray-50", children: /* @__PURE__ */ o.jsxDEV("tr", { children: [
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Order Number" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 344,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Order Date" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 347,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Total Amount" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 350,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Status" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 353,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Items" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 356,
            columnNumber: 23
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 343,
          columnNumber: 21
        }, void 0) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 342,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("tbody", { className: "bg-white divide-y divide-gray-200", children: v.map((R) => {
          var k;
          return /* @__PURE__ */ o.jsxDEV("tr", { children: [
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: R.orderNumber }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 364,
              columnNumber: 25
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: R.orderDate }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 367,
              columnNumber: 25
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: [
              h.currency,
              " ",
              R.totalAmount
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 370,
              columnNumber: 25
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: R.status }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 373,
              columnNumber: 25
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: [
              ((k = R.items) == null ? void 0 : k.length) || 0,
              " items"
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 376,
              columnNumber: 25
            }, void 0)
          ] }, R.id, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 363,
            columnNumber: 23
          }, void 0);
        }) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 361,
          columnNumber: 19
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 341,
        columnNumber: 17
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 340,
        columnNumber: 15
      }, void 0) : /* @__PURE__ */ o.jsxDEV("div", { className: "p-8 text-center text-gray-500", children: "No orders found for this agreement" }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 385,
        columnNumber: 15
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 338,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 337,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "consumer", children: /* @__PURE__ */ o.jsxDEV("div", { className: "space-y-4", children: [
        /* @__PURE__ */ o.jsxDEV("h3", { className: "font-semibold", children: "Consumer Information" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 394,
          columnNumber: 13
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("div", { className: "bg-gray-50 p-4 rounded", children: /* @__PURE__ */ o.jsxDEV("dl", { className: "space-y-2", children: [
          /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
            /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Consumer ID:" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 398,
              columnNumber: 19
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("dd", { className: "font-mono text-sm", children: h.consumer }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 399,
              columnNumber: 19
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 397,
            columnNumber: 17
          }, void 0),
          b ? /* @__PURE__ */ o.jsxDEV(o.Fragment, { children: [
            /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
              /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Mapped Company:" }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 404,
                columnNumber: 23
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("dd", { children: b.name }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 405,
                columnNumber: 23
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 403,
              columnNumber: 21
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
              /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Company Type:" }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 408,
                columnNumber: 23
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("dd", { children: b.type }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
                lineNumber: 409,
                columnNumber: 23
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 407,
              columnNumber: 21
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 402,
            columnNumber: 19
          }, void 0) : /* @__PURE__ */ o.jsxDEV("div", { className: "mt-4", children: /* @__PURE__ */ o.jsxDEV("div", { className: "p-4 rounded-md bg-yellow-50 text-yellow-800 border border-yellow-200", children: "This consumer is not mapped to any company in Alga PSA. You may need to create or link a company for billing purposes." }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 414,
            columnNumber: 21
          }, void 0) }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 413,
            columnNumber: 19
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 396,
          columnNumber: 15
        }, void 0) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 395,
          columnNumber: 13
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 393,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 392,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "billing", children: /* @__PURE__ */ o.jsxDEV("div", { className: "space-y-4", children: [
        /* @__PURE__ */ o.jsxDEV("h3", { className: "font-semibold", children: "Billing Configuration" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 427,
          columnNumber: 13
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("div", { className: "p-4 rounded-md bg-blue-50 text-blue-800 border border-blue-200", children: [
          "Billing integration features will be available in the next version. This will allow you to:",
          /* @__PURE__ */ o.jsxDEV("ul", { className: "list-disc list-inside mt-2", children: [
            /* @__PURE__ */ o.jsxDEV("li", { children: "Map agreement charges to Alga invoices" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 432,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("li", { children: "Configure automated billing rules" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 433,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("li", { children: "Set up markup percentages" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 434,
              columnNumber: 17
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("li", { children: "Generate billing reports" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
              lineNumber: 435,
              columnNumber: 17
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 431,
            columnNumber: 15
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 428,
          columnNumber: 13
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 426,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 425,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "details", children: /* @__PURE__ */ o.jsxDEV("div", { className: "space-y-4", children: [
        /* @__PURE__ */ o.jsxDEV("h3", { className: "font-semibold", children: "Technical Details" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 443,
          columnNumber: 13
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("div", { className: "bg-gray-50 p-4 rounded font-mono text-sm", children: /* @__PURE__ */ o.jsxDEV("pre", { children: JSON.stringify(h, null, 2) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 445,
          columnNumber: 15
        }, void 0) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 444,
          columnNumber: 13
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 442,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 441,
        columnNumber: 9
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
      lineNumber: 169,
      columnNumber: 7
    }, void 0),
    /* @__PURE__ */ o.jsxDEV(xi, { open: d, onClose: () => m(!1), children: /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: [
      /* @__PURE__ */ o.jsxDEV("h2", { className: "text-lg font-semibold mb-4", children: "Activate Agreement" }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 454,
        columnNumber: 11
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("p", { className: "mb-6", children: "Are you sure you want to activate this agreement? This will update the status in SoftwareOne and enable billing features." }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 455,
        columnNumber: 11
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-end gap-3", children: [
        /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => m(!1),
            className: "px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300",
            children: "Cancel"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 460,
            columnNumber: 13
          },
          void 0
        ),
        /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: j,
            className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700",
            children: "Activate"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
            lineNumber: 466,
            columnNumber: 13
          },
          void 0
        )
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 459,
        columnNumber: 11
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
      lineNumber: 453,
      columnNumber: 9
    }, void 0) }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
      lineNumber: 452,
      columnNumber: 7
    }, void 0),
    /* @__PURE__ */ o.jsxDEV(xi, { open: u, onClose: () => f(!1), children: /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: [
      /* @__PURE__ */ o.jsxDEV("h2", { className: "text-lg font-semibold mb-4", children: "Edit Agreement Configuration" }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 479,
        columnNumber: 11
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "p-4 rounded-md bg-blue-50 text-blue-800 border border-blue-200", children: "Edit functionality will be implemented in the next phase." }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 480,
        columnNumber: 11
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-end mt-6", children: /* @__PURE__ */ o.jsxDEV(
        "button",
        {
          onClick: () => f(!1),
          className: "px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300",
          children: "Close"
        },
        void 0,
        !1,
        {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
          lineNumber: 484,
          columnNumber: 13
        },
        void 0
      ) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
        lineNumber: 483,
        columnNumber: 11
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
      lineNumber: 478,
      columnNumber: 9
    }, void 0) }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
      lineNumber: 477,
      columnNumber: 7
    }, void 0)
  ] }, void 0, !0, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/AgreementDetail.tsx",
    lineNumber: 136,
    columnNumber: 5
  }, void 0);
}, Kg = ({ context: t }) => {
  var v;
  const e = Nr(), { storage: n, logger: r } = t, [s, a] = Ae([]), [i, l] = Ae("all"), [u, f] = Ae({
    from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0],
    to: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
  }), { data: d, isLoading: m, error: h } = Tt(
    ["statements", i, u.from, u.to],
    async () => {
      const b = n.getNamespace("swone");
      let j = await b.get("statements") || [];
      return i !== "all" && (j = (await b.get("statements/byStatus") || {})[i] || []), (u.from || u.to) && (j = j.filter((F) => {
        const D = new Date(F.periodEnd), R = u.from ? new Date(u.from) : /* @__PURE__ */ new Date(0), k = u.to ? new Date(u.to) : /* @__PURE__ */ new Date();
        return D >= R && D <= k;
      })), j;
    }
  ), S = (b) => {
    e(`/softwareone/statement/${b.id}`);
  }, x = (b) => {
    a((j) => j.includes(b) ? j.filter((F) => F !== b) : [...j, b]);
  }, E = () => {
    s.length === (d == null ? void 0 : d.length) ? a([]) : a((d == null ? void 0 : d.map((b) => b.id)) || []);
  }, g = async () => {
    s.length !== 0 && (r.info("Bulk billing requested for statements", { statementIds: s }), alert(`Billing integration for ${s.length} statements will be implemented in the next phase`));
  };
  return h ? /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: /* @__PURE__ */ o.jsxDEV("div", { className: "p-4 rounded-md bg-red-50 text-red-800 border border-red-200", children: [
    "Failed to load statements: ",
    h instanceof Error ? h.message : "Unknown error"
  ] }, void 0, !0, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
    lineNumber: 86,
    columnNumber: 9
  }, void 0) }, void 0, !1, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
    lineNumber: 85,
    columnNumber: 7
  }, void 0) : /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: [
    /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between items-center mb-6", children: [
      /* @__PURE__ */ o.jsxDEV("h1", { className: "text-2xl font-bold", children: "SoftwareOne Statements" }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 96,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "flex gap-3", children: [
        s.length > 0 && /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: g,
            className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700",
            children: [
              "Bill Selected (",
              s.length,
              ")"
            ]
          },
          void 0,
          !0,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
            lineNumber: 100,
            columnNumber: 13
          },
          void 0
        ),
        /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => e("/softwareone/agreements"),
            className: "px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300",
            children: "View Agreements"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
            lineNumber: 107,
            columnNumber: 11
          },
          void 0
        )
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 98,
        columnNumber: 9
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
      lineNumber: 95,
      columnNumber: 7
    }, void 0),
    /* @__PURE__ */ o.jsxDEV("div", { className: "mb-6 flex flex-wrap gap-4", children: [
      /* @__PURE__ */ o.jsxDEV("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => l("all"),
            className: `px-3 py-1 rounded-md text-sm ${i === "all" ? "bg-blue-600 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`,
            children: "All"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
            lineNumber: 118,
            columnNumber: 11
          },
          void 0
        ),
        /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => l("draft"),
            className: `px-3 py-1 rounded-md text-sm ${i === "draft" ? "bg-blue-600 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`,
            children: "Draft"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
            lineNumber: 128,
            columnNumber: 11
          },
          void 0
        ),
        /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => l("final"),
            className: `px-3 py-1 rounded-md text-sm ${i === "final" ? "bg-blue-600 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`,
            children: "Final"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
            lineNumber: 138,
            columnNumber: 11
          },
          void 0
        ),
        /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => l("billed"),
            className: `px-3 py-1 rounded-md text-sm ${i === "billed" ? "bg-blue-600 text-white" : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"}`,
            children: "Billed"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
            lineNumber: 148,
            columnNumber: 11
          },
          void 0
        )
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 117,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "flex gap-2 items-center", children: [
        /* @__PURE__ */ o.jsxDEV("label", { className: "text-sm text-gray-600", children: "From:" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
          lineNumber: 161,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(
          "input",
          {
            type: "date",
            value: u.from,
            onChange: (b) => f((j) => ({ ...j, from: b.target.value })),
            className: "px-3 py-1 border rounded"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
            lineNumber: 162,
            columnNumber: 11
          },
          void 0
        ),
        /* @__PURE__ */ o.jsxDEV("label", { className: "text-sm text-gray-600", children: "To:" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
          lineNumber: 168,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(
          "input",
          {
            type: "date",
            value: u.to,
            onChange: (b) => f((j) => ({ ...j, to: b.target.value })),
            className: "px-3 py-1 border rounded"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
            lineNumber: 169,
            columnNumber: 11
          },
          void 0
        )
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 160,
        columnNumber: 9
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
      lineNumber: 116,
      columnNumber: 7
    }, void 0),
    d && d.length === 0 ? /* @__PURE__ */ o.jsxDEV("div", { className: "p-4 rounded-md bg-blue-50 text-blue-800 border border-blue-200", children: /* @__PURE__ */ o.jsxDEV("p", { children: "No statements found for the selected criteria." }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
      lineNumber: 180,
      columnNumber: 11
    }, void 0) }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
      lineNumber: 179,
      columnNumber: 9
    }, void 0) : /* @__PURE__ */ o.jsxDEV("div", { className: "bg-white rounded-lg shadow overflow-hidden", children: /* @__PURE__ */ o.jsxDEV("div", { className: "overflow-x-auto", children: /* @__PURE__ */ o.jsxDEV("table", { className: "min-w-full divide-y divide-gray-200", children: [
      /* @__PURE__ */ o.jsxDEV("thead", { className: "bg-gray-50", children: /* @__PURE__ */ o.jsxDEV("tr", { children: [
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-4 py-3 text-left", children: /* @__PURE__ */ o.jsxDEV(
          "input",
          {
            type: "checkbox",
            checked: s.length === (d == null ? void 0 : d.length) && (d == null ? void 0 : d.length) > 0,
            onChange: E,
            className: "rounded border-gray-300"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
            lineNumber: 189,
            columnNumber: 21
          },
          void 0
        ) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
          lineNumber: 188,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Statement #" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
          lineNumber: 196,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Period Start" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
          lineNumber: 199,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Period End" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
          lineNumber: 202,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Total Amount" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
          lineNumber: 205,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Charges" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
          lineNumber: 208,
          columnNumber: 19
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Status" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
          lineNumber: 211,
          columnNumber: 19
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 187,
        columnNumber: 17
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 186,
        columnNumber: 15
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("tbody", { className: "bg-white divide-y divide-gray-200", children: m ? /* @__PURE__ */ o.jsxDEV("tr", { children: /* @__PURE__ */ o.jsxDEV("td", { colSpan: 7, className: "px-6 py-4 text-center text-gray-500", children: "Loading..." }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 219,
        columnNumber: 21
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 218,
        columnNumber: 19
      }, void 0) : d == null ? void 0 : d.map((b) => {
        var j;
        return /* @__PURE__ */ o.jsxDEV(
          "tr",
          {
            className: "hover:bg-gray-50 cursor-pointer",
            onClick: () => S(b),
            children: [
              /* @__PURE__ */ o.jsxDEV("td", { className: "px-4 py-4", onClick: (F) => F.stopPropagation(), children: /* @__PURE__ */ o.jsxDEV(
                "input",
                {
                  type: "checkbox",
                  checked: s.includes(b.id),
                  onChange: () => x(b.id),
                  className: "rounded border-gray-300"
                },
                void 0,
                !1,
                {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
                  lineNumber: 231,
                  columnNumber: 25
                },
                void 0
              ) }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
                lineNumber: 230,
                columnNumber: 23
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap", children: /* @__PURE__ */ o.jsxDEV(
                "button",
                {
                  onClick: (F) => {
                    F.stopPropagation(), S(b);
                  },
                  className: "text-blue-600 hover:underline font-mono",
                  children: b.statementNumber
                },
                void 0,
                !1,
                {
                  fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
                  lineNumber: 239,
                  columnNumber: 25
                },
                void 0
              ) }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
                lineNumber: 238,
                columnNumber: 23
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: new Date(b.periodStart).toLocaleDateString() }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
                lineNumber: 249,
                columnNumber: 23
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: new Date(b.periodEnd).toLocaleDateString() }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
                lineNumber: 252,
                columnNumber: 23
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900", children: [
                b.currency,
                " ",
                b.totalAmount.toLocaleString()
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
                lineNumber: 255,
                columnNumber: 23
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: [
                ((j = b.charges) == null ? void 0 : j.length) || 0,
                " items"
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
                lineNumber: 258,
                columnNumber: 23
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap", children: /* @__PURE__ */ o.jsxDEV("span", { className: `px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${b.status === "draft" ? "bg-yellow-100 text-yellow-800" : b.status === "final" ? "bg-blue-100 text-blue-800" : b.status === "billed" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`, children: b.status.charAt(0).toUpperCase() + b.status.slice(1) }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
                lineNumber: 262,
                columnNumber: 25
              }, void 0) }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
                lineNumber: 261,
                columnNumber: 23
              }, void 0)
            ]
          },
          b.id,
          !0,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
            lineNumber: 225,
            columnNumber: 21
          },
          void 0
        );
      }) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 216,
        columnNumber: 15
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
      lineNumber: 185,
      columnNumber: 13
    }, void 0) }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
      lineNumber: 184,
      columnNumber: 11
    }, void 0) }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
      lineNumber: 183,
      columnNumber: 9
    }, void 0),
    s.length > 0 && /* @__PURE__ */ o.jsxDEV("div", { className: "mt-4 p-4 bg-gray-50 rounded", children: /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between items-center", children: [
      /* @__PURE__ */ o.jsxDEV("p", { className: "text-sm text-gray-600", children: [
        s.length,
        " statement",
        s.length > 1 ? "s" : "",
        " selected"
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 283,
        columnNumber: 13
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "text-sm font-medium", children: [
        "Total selected: ",
        d == null ? void 0 : d.filter((b) => s.includes(b.id)).reduce((b, j) => b + j.totalAmount, 0).toLocaleString(),
        " ",
        (v = d == null ? void 0 : d[0]) == null ? void 0 : v.currency
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
        lineNumber: 286,
        columnNumber: 13
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
      lineNumber: 282,
      columnNumber: 11
    }, void 0) }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
      lineNumber: 281,
      columnNumber: 9
    }, void 0)
  ] }, void 0, !0, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementsList.tsx",
    lineNumber: 94,
    columnNumber: 5
  }, void 0);
}, Jg = ({ context: t }) => {
  const { id: e } = wi(), n = Nr(), { storage: r, logger: s } = t, [a, i] = Ae("charges"), { data: l, isLoading: u, error: f } = Tt(
    ["statement", e || ""],
    async () => e && (await r.getNamespace("swone").get("statements/byId") || {})[e] || null
  ), { data: d } = Tt(
    ["agreements/byId"],
    async () => await r.getNamespace("swone").get("agreements/byId") || {}
  ), m = async () => {
    try {
      s.info("Billing statement", { statementId: e }), alert("Billing integration will be implemented in the next phase");
    } catch (x) {
      s.error("Failed to bill statement", x);
    }
  };
  if (u)
    return /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: "Loading statement details..." }, void 0, !1, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
      lineNumber: 53,
      columnNumber: 12
    }, void 0);
  if (f || !l)
    return /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: [
      /* @__PURE__ */ o.jsxDEV("div", { className: "p-4 rounded-md bg-red-50 text-red-800 border border-red-200", children: "Failed to load statement details" }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 59,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(
        "button",
        {
          onClick: () => n("/softwareone/statements"),
          className: "mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700",
          children: "Back to Statements"
        },
        void 0,
        !1,
        {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 62,
          columnNumber: 9
        },
        void 0
      )
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
      lineNumber: 58,
      columnNumber: 7
    }, void 0);
  const h = l.charges.map((x) => {
    var E, g, v;
    return {
      ...x,
      agreementName: ((E = d == null ? void 0 : d[x.agreementId]) == null ? void 0 : E.name) || "Unknown Agreement",
      vendor: ((g = d == null ? void 0 : d[x.agreementId]) == null ? void 0 : g.vendor) || "-",
      product: ((v = d == null ? void 0 : d[x.agreementId]) == null ? void 0 : v.product) || "-"
    };
  }), S = h.reduce((x, E) => (x[E.agreementId] || (x[E.agreementId] = {
    agreementId: E.agreementId,
    agreementName: E.agreementName,
    vendor: E.vendor,
    product: E.product,
    charges: [],
    totalAmount: 0
  }), x[E.agreementId].charges.push(E), x[E.agreementId].totalAmount += E.totalAmount, x), {});
  return /* @__PURE__ */ o.jsxDEV("div", { className: "p-6", children: [
    /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between items-start mb-6", children: [
      /* @__PURE__ */ o.jsxDEV("div", { children: [
        /* @__PURE__ */ o.jsxDEV("div", { className: "flex items-center gap-2 mb-2", children: /* @__PURE__ */ o.jsxDEV(
          "button",
          {
            onClick: () => n("/softwareone/statements"),
            className: "px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200",
            children: "← Back"
          },
          void 0,
          !1,
          {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 102,
            columnNumber: 13
          },
          void 0
        ) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 101,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("h1", { className: "text-2xl font-bold", children: [
          "Statement ",
          l.statementNumber
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 109,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("p", { className: "text-gray-600", children: [
          new Date(l.periodStart).toLocaleDateString(),
          " - ",
          new Date(l.periodEnd).toLocaleDateString()
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 110,
          columnNumber: 11
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 100,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "flex gap-3", children: l.status === "final" && /* @__PURE__ */ o.jsxDEV(
        "button",
        {
          onClick: m,
          className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700",
          children: "Create Invoice"
        },
        void 0,
        !1,
        {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 117,
          columnNumber: 13
        },
        void 0
      ) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 115,
        columnNumber: 9
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
      lineNumber: 99,
      columnNumber: 7
    }, void 0),
    /* @__PURE__ */ o.jsxDEV("div", { className: "grid grid-cols-3 gap-6 mb-6", children: [
      /* @__PURE__ */ o.jsxDEV("div", { className: "bg-white p-4 rounded-lg shadow", children: [
        /* @__PURE__ */ o.jsxDEV("h3", { className: "text-sm font-medium text-gray-500 mb-1", children: "Total Amount" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 129,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("p", { className: "text-2xl font-bold", children: [
          l.currency,
          " ",
          l.totalAmount.toLocaleString()
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 130,
          columnNumber: 11
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 128,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "bg-white p-4 rounded-lg shadow", children: [
        /* @__PURE__ */ o.jsxDEV("h3", { className: "text-sm font-medium text-gray-500 mb-1", children: "Status" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 135,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("span", { className: `inline-block px-3 py-1 rounded-full text-sm font-medium ${l.status === "draft" ? "bg-yellow-100 text-yellow-800" : l.status === "final" ? "bg-blue-100 text-blue-800" : "bg-green-100 text-green-800"}`, children: l.status.charAt(0).toUpperCase() + l.status.slice(1) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 136,
          columnNumber: 11
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 134,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV("div", { className: "bg-white p-4 rounded-lg shadow", children: [
        /* @__PURE__ */ o.jsxDEV("h3", { className: "text-sm font-medium text-gray-500 mb-1", children: "Charges" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 145,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("p", { className: "text-2xl font-bold", children: l.charges.length }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 146,
          columnNumber: 11
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 144,
        columnNumber: 9
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
      lineNumber: 127,
      columnNumber: 7
    }, void 0),
    /* @__PURE__ */ o.jsxDEV(Gs, { value: a, onValueChange: i, className: "w-full", children: [
      /* @__PURE__ */ o.jsxDEV(Ks, { className: "flex border-b mb-6", children: [
        /* @__PURE__ */ o.jsxDEV(He, { value: "charges", className: "px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: [
          "Charges (",
          l.charges.length,
          ")"
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 152,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(He, { value: "summary", className: "px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: "Summary by Agreement" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 155,
          columnNumber: 11
        }, void 0),
        /* @__PURE__ */ o.jsxDEV(He, { value: "details", className: "px-4 py-2 hover:bg-gray-50 data-[state=active]:border-b-2 data-[state=active]:border-blue-500", children: "Details" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 158,
          columnNumber: 11
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 151,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "charges", children: /* @__PURE__ */ o.jsxDEV("div", { className: "bg-white rounded-lg shadow overflow-hidden", children: /* @__PURE__ */ o.jsxDEV("div", { className: "overflow-x-auto", children: /* @__PURE__ */ o.jsxDEV("table", { className: "min-w-full divide-y divide-gray-200", children: [
        /* @__PURE__ */ o.jsxDEV("thead", { className: "bg-gray-50", children: /* @__PURE__ */ o.jsxDEV("tr", { children: [
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Agreement" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 169,
            columnNumber: 21
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Description" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 172,
            columnNumber: 21
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Date" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 175,
            columnNumber: 21
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Quantity" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 178,
            columnNumber: 21
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Unit Price" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 181,
            columnNumber: 21
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Total" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 184,
            columnNumber: 21
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 168,
          columnNumber: 19
        }, void 0) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 167,
          columnNumber: 17
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("tbody", { className: "bg-white divide-y divide-gray-200", children: h.map((x) => /* @__PURE__ */ o.jsxDEV("tr", { children: [
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap", children: /* @__PURE__ */ o.jsxDEV(
            "button",
            {
              onClick: () => n(`/softwareone/agreement/${x.agreementId}`),
              className: "text-blue-600 hover:underline text-sm",
              children: x.agreementName
            },
            void 0,
            !1,
            {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 193,
              columnNumber: 25
            },
            void 0
          ) }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 192,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 text-sm text-gray-900", children: x.description }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 200,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: x.chargeDate }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 203,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: x.quantity }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 206,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: [
            l.currency,
            " ",
            x.unitPrice
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 209,
            columnNumber: 23
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("td", { className: "px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900", children: [
            l.currency,
            " ",
            x.totalAmount.toLocaleString()
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 212,
            columnNumber: 23
          }, void 0)
        ] }, x.id, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 191,
          columnNumber: 21
        }, void 0)) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 189,
          columnNumber: 17
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 166,
        columnNumber: 15
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 165,
        columnNumber: 13
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 164,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 163,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "summary", children: /* @__PURE__ */ o.jsxDEV("div", { className: "space-y-4", children: Object.values(S).map((x) => /* @__PURE__ */ o.jsxDEV("div", { className: "bg-white p-6 rounded-lg shadow", children: [
        /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between items-start mb-4", children: [
          /* @__PURE__ */ o.jsxDEV("div", { children: [
            /* @__PURE__ */ o.jsxDEV("h3", { className: "font-semibold", children: /* @__PURE__ */ o.jsxDEV(
              "button",
              {
                onClick: () => n(`/softwareone/agreement/${x.agreementId}`),
                className: "text-blue-600 hover:underline",
                children: x.agreementName
              },
              void 0,
              !1,
              {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
                lineNumber: 230,
                columnNumber: 23
              },
              void 0
            ) }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 229,
              columnNumber: 21
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("p", { className: "text-sm text-gray-600", children: [
              x.vendor,
              " • ",
              x.product
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 237,
              columnNumber: 21
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 228,
            columnNumber: 19
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { className: "text-right", children: [
            /* @__PURE__ */ o.jsxDEV("p", { className: "text-lg font-semibold", children: [
              l.currency,
              " ",
              x.totalAmount.toLocaleString()
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 242,
              columnNumber: 21
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("p", { className: "text-sm text-gray-600", children: [
              x.charges.length,
              " charges"
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 245,
              columnNumber: 21
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 241,
            columnNumber: 19
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 227,
          columnNumber: 17
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("div", { className: "border-t pt-4", children: /* @__PURE__ */ o.jsxDEV("div", { className: "overflow-x-auto", children: [
          /* @__PURE__ */ o.jsxDEV("table", { className: "min-w-full divide-y divide-gray-200", children: [
            /* @__PURE__ */ o.jsxDEV("thead", { className: "bg-gray-50", children: /* @__PURE__ */ o.jsxDEV("tr", { children: [
              /* @__PURE__ */ o.jsxDEV("th", { className: "px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Description" }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
                lineNumber: 256,
                columnNumber: 27
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("th", { className: "px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Qty" }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
                lineNumber: 259,
                columnNumber: 27
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("th", { className: "px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Amount" }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
                lineNumber: 262,
                columnNumber: 27
              }, void 0)
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 255,
              columnNumber: 25
            }, void 0) }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 254,
              columnNumber: 23
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("tbody", { className: "bg-white divide-y divide-gray-200", children: x.charges.slice(0, 5).map((E) => /* @__PURE__ */ o.jsxDEV("tr", { children: [
              /* @__PURE__ */ o.jsxDEV("td", { className: "px-4 py-2 text-sm text-gray-900", children: E.description }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
                lineNumber: 270,
                columnNumber: 29
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("td", { className: "px-4 py-2 text-sm text-gray-900", children: E.quantity }, void 0, !1, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
                lineNumber: 273,
                columnNumber: 29
              }, void 0),
              /* @__PURE__ */ o.jsxDEV("td", { className: "px-4 py-2 text-sm font-medium text-gray-900", children: [
                l.currency,
                " ",
                E.totalAmount.toLocaleString()
              ] }, void 0, !0, {
                fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
                lineNumber: 276,
                columnNumber: 29
              }, void 0)
            ] }, E.id, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 269,
              columnNumber: 27
            }, void 0)) }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 267,
              columnNumber: 23
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 253,
            columnNumber: 21
          }, void 0),
          x.charges.length > 5 && /* @__PURE__ */ o.jsxDEV("div", { className: "px-4 py-2 text-sm text-gray-500", children: [
            "... and ",
            x.charges.length - 5,
            " more charges"
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 284,
            columnNumber: 23
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 252,
          columnNumber: 19
        }, void 0) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 251,
          columnNumber: 17
        }, void 0)
      ] }, x.agreementId, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 226,
        columnNumber: 15
      }, void 0)) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 224,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 223,
        columnNumber: 9
      }, void 0),
      /* @__PURE__ */ o.jsxDEV(Ge, { value: "details", children: /* @__PURE__ */ o.jsxDEV("div", { className: "space-y-4", children: [
        /* @__PURE__ */ o.jsxDEV("h3", { className: "font-semibold", children: "Statement Details" }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 297,
          columnNumber: 13
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("div", { className: "bg-gray-50 p-4 rounded", children: /* @__PURE__ */ o.jsxDEV("dl", { className: "space-y-2", children: [
          /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
            /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Statement ID:" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 301,
              columnNumber: 19
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("dd", { className: "font-mono text-sm", children: l.id }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 302,
              columnNumber: 19
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 300,
            columnNumber: 17
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
            /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Statement Number:" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 305,
              columnNumber: 19
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("dd", { children: l.statementNumber }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 306,
              columnNumber: 19
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 304,
            columnNumber: 17
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
            /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Period:" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 309,
              columnNumber: 19
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("dd", { children: [
              new Date(l.periodStart).toLocaleDateString(),
              " -",
              new Date(l.periodEnd).toLocaleDateString()
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 310,
              columnNumber: 19
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 308,
            columnNumber: 17
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
            /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Currency:" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 316,
              columnNumber: 19
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("dd", { children: l.currency }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 317,
              columnNumber: 19
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 315,
            columnNumber: 17
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
            /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Total Charges:" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 320,
              columnNumber: 19
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("dd", { children: l.charges.length }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 321,
              columnNumber: 19
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 319,
            columnNumber: 17
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { className: "flex justify-between", children: [
            /* @__PURE__ */ o.jsxDEV("dt", { className: "text-gray-600", children: "Total Amount:" }, void 0, !1, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 324,
              columnNumber: 19
            }, void 0),
            /* @__PURE__ */ o.jsxDEV("dd", { className: "font-semibold", children: [
              l.currency,
              " ",
              l.totalAmount.toLocaleString()
            ] }, void 0, !0, {
              fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
              lineNumber: 325,
              columnNumber: 19
            }, void 0)
          ] }, void 0, !0, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 323,
            columnNumber: 17
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 299,
          columnNumber: 15
        }, void 0) }, void 0, !1, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 298,
          columnNumber: 13
        }, void 0),
        /* @__PURE__ */ o.jsxDEV("div", { className: "mt-6", children: [
          /* @__PURE__ */ o.jsxDEV("h3", { className: "font-semibold mb-2", children: "Raw Data" }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 333,
            columnNumber: 15
          }, void 0),
          /* @__PURE__ */ o.jsxDEV("div", { className: "bg-gray-50 p-4 rounded font-mono text-sm overflow-auto", children: /* @__PURE__ */ o.jsxDEV("pre", { children: JSON.stringify(l, null, 2) }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 335,
            columnNumber: 17
          }, void 0) }, void 0, !1, {
            fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
            lineNumber: 334,
            columnNumber: 15
          }, void 0)
        ] }, void 0, !0, {
          fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
          lineNumber: 332,
          columnNumber: 13
        }, void 0)
      ] }, void 0, !0, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 296,
        columnNumber: 11
      }, void 0) }, void 0, !1, {
        fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
        lineNumber: 295,
        columnNumber: 9
      }, void 0)
    ] }, void 0, !0, {
      fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
      lineNumber: 150,
      columnNumber: 7
    }, void 0)
  ] }, void 0, !0, {
    fileName: "/home/coder/alga-psa/extensions/softwareone-ext/src/pages/StatementDetail.tsx",
    lineNumber: 98,
    columnNumber: 5
  }, void 0);
};
async function Qg(t, e) {
  const { storage: n, logger: r } = e;
  try {
    const s = await n.getNamespace("swone").get("config");
    if (!s || !s.apiToken || !s.apiEndpoint)
      return new Response(
        JSON.stringify({
          success: !1,
          message: "SoftwareOne API not configured. Please configure settings first."
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    const i = new URL(t.url).searchParams.get("full") === "true";
    r.info("Starting SoftwareOne sync", { fullSync: i });
    const u = await new Gn(s, e).performFullSync();
    return new Response(
      JSON.stringify(u),
      {
        status: u.success ? 200 : 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (s) {
    r.error("Sync endpoint error", s);
    const a = {
      success: !1,
      message: "Internal server error during sync",
      errors: [s instanceof Error ? s.message : "Unknown error"]
    };
    return new Response(
      JSON.stringify(a),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
async function Xg(t, e) {
  const { storage: n, logger: r } = e;
  try {
    const s = await t.json(), { agreementId: a } = s;
    if (!a)
      return new Response(
        JSON.stringify({
          success: !1,
          message: "Agreement ID is required"
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    const i = await n.getNamespace("swone").get("config");
    if (!i || !i.apiToken || !i.apiEndpoint)
      return new Response(
        JSON.stringify({
          success: !1,
          message: "SoftwareOne API not configured"
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    r.info("Activating agreement", { agreementId: a });
    const u = await new Zs(i).activateAgreement(a);
    return await new Gn(i, e).refreshAgreement(a), r.info("Agreement activated successfully", { agreementId: a }), new Response(
      JSON.stringify({
        success: !0,
        message: "Agreement activated successfully",
        agreement: u
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (s) {
    return r.error("Activate agreement error", s), new Response(
      JSON.stringify({
        success: !1,
        message: s instanceof Error ? s.message : "Failed to activate agreement"
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
async function Zg(t) {
  const { logger: e, storage: n } = t;
  e.info("SoftwareOne Extension initializing", {
    version: "0.1.0",
    tenant: t.tenant.id
  });
  const r = n.getNamespace("swone");
  await r.get("config") || (e.info("No configuration found, setting defaults"), await r.set("config", {
    apiEndpoint: "https://api.softwareone.com",
    apiToken: "",
    syncInterval: 60,
    enableAutoSync: !1
  })), e.info("SoftwareOne Extension initialized successfully");
}
const ex = {
  id: "com.alga.softwareone",
  name: "SoftwareOne Integration",
  version: "0.1.0",
  description: "Browse and bill SoftwareOne agreements inside Alga PSA",
  author: {
    name: "Alga Development Team",
    email: "dev@alga.io"
  }
};
export {
  Gg as AgreementDetail,
  Hg as AgreementsList,
  Ag as NavItem,
  Yg as SettingsPage,
  Jg as StatementDetail,
  Kg as StatementsList,
  Xg as activateAgreement,
  Zg as initialize,
  ex as metadata,
  Qg as runSync
};
//# sourceMappingURL=index.mjs.map
