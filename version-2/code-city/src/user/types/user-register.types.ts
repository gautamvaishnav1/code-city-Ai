import { Provider } from './user.provider.type.js';

export interface userRegister{
    email?:string;
    name?:string;
    password?:string;
    provider:Provider;
    providerId?:string;
    profileImage?:string;
    githubAccessToken?:string
}