// User model

export class User {
  constructor(data = {}) {
    this.id = data.id;
    this.email = data.email;
    this.displayName = data.displayName;
    this.firstName = data.firstName;
    this.lastName = data.lastName;
    this.authMethod = data.authMethod;
    this.profile = data.profile || {};
  }

  static fromPassportProfile(profile) {
    return new User({
      id: profile.id,
      email: profile.emails?.[0]?.value,
      displayName: profile.displayName,
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
      authMethod: profile.authMethod,
      profile: profile,
    });
  }

  toJSON() {
    return {
      id: this.id,
      email: this.email,
      displayName: this.displayName,
      firstName: this.firstName,
      lastName: this.lastName,
      authMethod: this.authMethod,
    };
  }

  get fullName() {
    return `${this.firstName || ''} ${this.lastName || ''}`.trim();
  }

  isValid() {
    return this.email && this.displayName;
  }
}

export default User;
