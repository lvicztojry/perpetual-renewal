import { clearLocalSession, localSession, requireLocalSession } from "./account";
export { AuthenticationRequiredError } from "../../../src/lib/auth/errors";
export const getCurrentSession = async () => requireLocalSession();
export const getOptionalSession = async () => localSession();
export const clearCurrentSession = async () => clearLocalSession();
export const isLocalEmailAuthEnabled = () => false;
