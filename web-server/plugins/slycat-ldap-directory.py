import cherrypy
import datetime
import traceback

configuration = {
  "cache"    : {},
  "server"   : None,
  "base"     : None,
  "who"      : None,
  "cred"     : None,
  "attrlist" : None,
  "ldapEmail": None,
  "timeout"  : None
}

def init(server, base, who="", cred="", attrlist=["uid", "cn", "mail"], ldapEmail="mail", timeout=datetime.timedelta(seconds=5)):
  global configuration
  configuration["server"] = server
  configuration["base"] = base
  configuration["who"] = who
  configuration["cred"] = cred
  configuration["attrlist"] = attrlist
  configuration["ldapEmail"] = ldapEmail
  configuration["timeout"] = timeout

def user(uid):
  global configuration
  if uid not in configuration["cache"]:
    try:
      # Lookup the given uid in ldap
      import ldap
      trace_level = 0  # 0=quiet,  1=verbose,  2=veryVerbose
      ldap.set_option(ldap.OPT_X_TLS_REQUIRE_CERT, ldap.OPT_X_TLS_NEVER)
      ldap.set_option(ldap.OPT_NETWORK_TIMEOUT, configuration["timeout"].total_seconds())
      connection = ldap.initialize(configuration["server"], trace_level)
      connection.simple_bind_s(configuration["who"], configuration["cred"])     # empty string ok

      # perform the query
      result = connection.search_s(configuration["base"], ldap.SCOPE_ONELEVEL, "uid=%s" % uid, configuration["attrlist"])

      if result == []: raise Exception("Supplied UID not found in query: %s" % uid)

      # Cache the information we need for speedy lookup.
      result = result[0][1]
      configuration["cache"][uid] = {
        "name" : result["cn"][0],
        "email" : result[configuration["ldapEmail"]][0],
        }
    except ldap.NO_SUCH_OBJECT:
      raise cherrypy.HTTPError(404)
    except:
      cherrypy.log.error(traceback.format_exc())
      raise cherrypy.HTTPError(500)
  return configuration["cache"][uid]

def register_slycat_plugin(context):
  context.register_directory("ldap", init, user)

