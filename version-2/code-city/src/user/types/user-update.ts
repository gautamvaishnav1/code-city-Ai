import { Provider } from './user.provider.type.js';

export interface userUpdate{
    email?:string;
    name?:string;
    password?:string;
    provider?:Provider;
    providerId?:string;
    profileImage?:string;
    githubAccessToken?:string
}